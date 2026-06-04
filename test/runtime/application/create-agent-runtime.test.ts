import { afterEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	Facade,
	FacadeEvent,
	ProviderModelInfo,
	RunParams,
	ServerEvent,
} from "../../../src/common/protocol.ts";
import { createAgentRuntime } from "../../../src/runtime/application/create-agent-runtime.ts";
import {
	CODING_STORAGE_OWNER_ID,
	CodingRepositoryStore,
	CodingSessionEventHub,
	CodingSessionStore,
	createCodingService,
} from "../../../src/runtime/coding/index.ts";
import { SessionStore } from "../../../src/runtime/persistence/session-store/session-store.ts";
import type { WsClient } from "../../../src/runtime/transport/client-hub.ts";
import { MockFacade } from "../../helpers/mock-facade.ts";

function mockWs(
	clientType: "telegram" | "tui" = "tui",
): WsClient & { events: () => ServerEvent[] } {
	const sent: string[] = [];
	const ws = {
		data: { clientType },
		send: (data: string) => {
			sent.push(data);
		},
		events: () => sent.map((item) => JSON.parse(item) as ServerEvent),
	};
	return ws as unknown as WsClient & { events: () => ServerEvent[] };
}

async function waitForDone(
	ws: WsClient & { events: () => ServerEvent[] },
): Promise<void> {
	return new Promise<void>((resolve) => {
		const check = setInterval(() => {
			if (ws.events().some((event) => event.type === "done")) {
				clearInterval(check);
				resolve();
			}
		}, 5);
	});
}

function createDeferred() {
	let resolve: () => void = () => {};
	const promise = new Promise<void>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

class BlockingFacade implements Facade {
	providerId = "mock";
	started = createDeferred();
	release = createDeferred();

	async *run(params: RunParams): AsyncIterable<FacadeEvent> {
		this.started.resolve();
		await this.release.promise;
		yield { type: "text", text: `echo: ${params.prompt}` };
		yield {
			type: "done",
			sessionId: `session-${params.prompt}`,
			durationMs: 1,
		};
	}
}

class RecordingFacade implements Facade {
	providerId = "mock";
	readonly seenParams: RunParams[] = [];

	async *run(params: RunParams): AsyncIterable<FacadeEvent> {
		this.seenParams.push(params);
		yield { type: "text", text: `echo: ${params.prompt}` };
		yield {
			type: "done",
			sessionId: params.resume ?? "sdk-shared",
			durationMs: 1,
		};
	}
}

class ProviderSessionFacade implements Facade {
	readonly seenParams: RunParams[] = [];

	constructor(
		readonly providerId: string,
		private readonly sessionId: string,
	) {}

	async *run(params: RunParams): AsyncIterable<FacadeEvent> {
		this.seenParams.push(params);
		yield {
			type: "session_initialized",
			sessionId: this.sessionId,
		};
		yield {
			type: "done",
			sessionId: this.sessionId,
			durationMs: 1,
		};
	}
}

class CatalogProviderSessionFacade extends ProviderSessionFacade {
	constructor(
		providerId: string,
		sessionId: string,
		private readonly models: ProviderModelInfo[],
	) {
		super(providerId, sessionId);
	}

	async listModels(): Promise<ProviderModelInfo[]> {
		return this.models;
	}
}

function providerModel(
	id: string,
	overrides: Partial<ProviderModelInfo> = {},
): ProviderModelInfo {
	return {
		id,
		model: id,
		displayName: id,
		description: id,
		isDefault: false,
		defaultReasoningEffort: "medium",
		supportedReasoningEfforts: ["low", "medium", "high"],
		serviceTiers: [],
		...overrides,
	};
}

const TEST_DB = join(import.meta.dir, ".tmp-create-agent-runtime.sqlite");

async function waitForCondition(
	check: () => boolean | Promise<boolean>,
	timeoutMs = 500,
) {
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		if (await check()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}

	throw new Error("Timed out waiting for condition");
}

describe("createAgentRuntime", () => {
	afterEach(() => {
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
		if (existsSync(`${TEST_DB}-wal`)) rmSync(`${TEST_DB}-wal`);
		if (existsSync(`${TEST_DB}-shm`)) rmSync(`${TEST_DB}-shm`);
	});

	test("emits runtime_status with the active agent name", async () => {
		const runtime = createAgentRuntime({
			agentId: "agent-railly",
			name: "railly",
			facade: new MockFacade(),
		});
		const ws = mockWs();

		runtime.handleOpen(ws);

		expect(
			ws.events().find((event) => event.type === "runtime_status"),
		).toEqual({
			type: "runtime_status",
			agentName: "railly",
			providerId: "mock",
			model: "",
			effort: "medium",
			running: false,
		});

		await runtime.stop();
	});

	test("includes a shared frontend notice in runtime_status when provided", async () => {
		const runtime = createAgentRuntime({
			agentId: "agent-railly",
			name: "railly",
			facade: new MockFacade(),
			getFrontendNotice: () => ({ kind: "restart_required" }),
		});
		const ws = mockWs();

		runtime.handleOpen(ws);

		expect(
			ws.events().find((event) => event.type === "runtime_status"),
		).toEqual({
			type: "runtime_status",
			agentName: "railly",
			providerId: "mock",
			model: "",
			effort: "medium",
			running: false,
			notice: {
				kind: "restart_required",
			},
		});

		await runtime.stop();
	});

	test("uses the configured default thinking effort on startup", async () => {
		const runtime = createAgentRuntime({
			agentId: "agent-railly",
			defaultEffort: "low",
			name: "railly",
			facade: new MockFacade(),
		});
		const ws = mockWs();

		runtime.handleOpen(ws);

		expect(
			ws.events().find((event) => event.type === "runtime_status"),
		).toMatchObject({
			type: "runtime_status",
			effort: "low",
		});

		await runtime.stop();
	});

	test("serves chat slash-command skills from the agent ./skills directory", async () => {
		const agentHome = mkdtempSync(join(tmpdir(), "outclaw-runtime-skills-"));
		mkdirSync(join(agentHome, "skills", "review"), { recursive: true });
		writeFileSync(
			join(agentHome, "skills", "review", "SKILL.md"),
			`---
name: review
description: Review the current changes.
---

# review
`,
		);
		const runtime = createAgentRuntime({
			agentId: "agent-railly",
			name: "railly",
			facade: new MockFacade(),
			cwd: agentHome,
			promptHomeDir: agentHome,
		});
		const ws = mockWs();

		try {
			runtime.handleOpen(ws);
			runtime.handleMessage(ws, JSON.stringify({ type: "request_skills" }));
			await waitForCondition(() =>
				ws.events().some((event) => event.type === "skills_update"),
			);

			expect(ws.events()).toContainEqual({
				type: "skills_update",
				skills: [
					{
						name: "review",
						description: "Review the current changes.",
					},
				],
			});
		} finally {
			await runtime.stop();
			rmSync(agentHome, { recursive: true, force: true });
		}
	});

	test("creates independent runtimes without opening network ports", async () => {
		const raillyFacade = new MockFacade();
		const mimiFacade = new MockFacade();
		const raillyRuntime = createAgentRuntime({
			agentId: "agent-railly",
			name: "railly",
			facade: raillyFacade,
			cwd: "/tmp/railly",
		});
		const mimiRuntime = createAgentRuntime({
			agentId: "agent-mimi",
			name: "mimi",
			facade: mimiFacade,
			cwd: "/tmp/mimi",
		});

		const raillyWs = mockWs();
		raillyRuntime.handleOpen(raillyWs);
		raillyRuntime.handleMessage(
			raillyWs,
			JSON.stringify({ type: "prompt", prompt: "hello railly" }),
		);
		await waitForDone(raillyWs);

		const mimiWs = mockWs();
		mimiRuntime.handleOpen(mimiWs);
		mimiRuntime.handleMessage(
			mimiWs,
			JSON.stringify({ type: "prompt", prompt: "hello mimi" }),
		);
		await waitForDone(mimiWs);

		expect(raillyFacade.lastParams?.cwd).toBe("/tmp/railly");
		expect(mimiFacade.lastParams?.cwd).toBe("/tmp/mimi");

		await raillyRuntime.stop();
		await mimiRuntime.stop();
	});

	test("allows different agent runtimes to execute in parallel", async () => {
		const raillyFacade = new BlockingFacade();
		const mimiFacade = new BlockingFacade();
		const raillyRuntime = createAgentRuntime({
			agentId: "agent-railly",
			name: "railly",
			facade: raillyFacade,
		});
		const mimiRuntime = createAgentRuntime({
			agentId: "agent-mimi",
			name: "mimi",
			facade: mimiFacade,
		});

		const raillyWs = mockWs();
		const mimiWs = mockWs();
		raillyRuntime.handleOpen(raillyWs);
		mimiRuntime.handleOpen(mimiWs);

		raillyRuntime.handleMessage(
			raillyWs,
			JSON.stringify({ type: "prompt", prompt: "hello railly" }),
		);
		mimiRuntime.handleMessage(
			mimiWs,
			JSON.stringify({ type: "prompt", prompt: "hello mimi" }),
		);

		await Promise.all([
			raillyFacade.started.promise,
			mimiFacade.started.promise,
		]);

		raillyFacade.release.resolve();
		mimiFacade.release.resolve();

		await Promise.all([waitForDone(raillyWs), waitForDone(mimiWs)]);

		expect(
			raillyWs.events().find((event) => event.type === "done"),
		).toBeDefined();
		expect(
			mimiWs.events().find((event) => event.type === "done"),
		).toBeDefined();

		await raillyRuntime.stop();
		await mimiRuntime.stop();
	});

	test("persists OC_SESSION_ID across runtime restart when resuming a stored session", async () => {
		const promptHomeDir = "/tmp/outclaw-agent";
		const firstFacade = new RecordingFacade();
		const firstStore = new SessionStore(TEST_DB, { journalMode: "DELETE" });
		const firstRuntime = createAgentRuntime({
			agentId: "agent-railly",
			name: "railly",
			facade: firstFacade,
			promptHomeDir,
			store: firstStore,
		});
		const firstWs = mockWs();

		firstRuntime.handleOpen(firstWs);
		firstRuntime.handleMessage(
			firstWs,
			JSON.stringify({ type: "prompt", prompt: "first prompt" }),
		);
		await waitForDone(firstWs);
		await firstRuntime.stop();
		firstStore.close();

		const secondFacade = new RecordingFacade();
		const secondStore = new SessionStore(TEST_DB, { journalMode: "DELETE" });
		const secondRuntime = createAgentRuntime({
			agentId: "agent-railly",
			name: "railly",
			facade: secondFacade,
			promptHomeDir,
			store: secondStore,
		});
		const secondWs = mockWs();

		secondRuntime.handleOpen(secondWs);
		secondRuntime.handleMessage(
			secondWs,
			JSON.stringify({ type: "prompt", prompt: "follow up" }),
		);
		await waitForDone(secondWs);

		expect(firstFacade.seenParams).toHaveLength(1);
		expect(secondFacade.seenParams).toHaveLength(1);
		expect(firstFacade.seenParams[0]?.resume).toBeUndefined();
		expect(secondFacade.seenParams[0]?.resume).toBe("sdk-shared");
		expect(firstFacade.seenParams[0]?.sessionEnv?.OC_SESSION_ID).toBeDefined();
		expect(secondFacade.seenParams[0]?.sessionEnv?.OC_SESSION_ID).toBe(
			"sdk-shared",
		);
		expect(secondStore.get("mock", "sdk-shared")?.ocSessionId).toBe(
			"sdk-shared",
		);

		await secondRuntime.stop();
		secondStore.close();
	});

	test("runtime restart canonicalizes a legacy ocSessionId alias back to sdkSessionId", async () => {
		const promptHomeDir = "/tmp/outclaw-agent";
		const seedStore = new SessionStore(TEST_DB, { journalMode: "DELETE" });
		seedStore.upsert({
			providerId: "mock",
			sdkSessionId: "sdk-legacy",
			ocSessionId: "oc-legacy",
			title: "Legacy chat",
			model: "opus",
			source: "tui",
		});
		seedStore.setActiveSessionId("mock", "sdk-legacy");
		seedStore.close();

		const facade = new RecordingFacade();
		const store = new SessionStore(TEST_DB, { journalMode: "DELETE" });
		const runtime = createAgentRuntime({
			agentId: "agent-railly",
			name: "railly",
			facade,
			promptHomeDir,
			store,
		});
		const ws = mockWs();

		runtime.handleOpen(ws);
		runtime.handleMessage(
			ws,
			JSON.stringify({ type: "prompt", prompt: "follow up" }),
		);
		await waitForDone(ws);

		expect(facade.seenParams).toHaveLength(1);
		expect(facade.seenParams[0]?.resume).toBe("sdk-legacy");
		expect(facade.seenParams[0]?.sessionEnv?.OC_SESSION_ID).toBe("sdk-legacy");
		expect(store.get("mock", "sdk-legacy")?.ocSessionId).toBe("sdk-legacy");

		await runtime.stop();
		store.close();
	});

	test("runtime restart does not duplicate rollover for an already handled idle epoch", async () => {
		const promptHomeDir = "/tmp/outclaw-agent";
		const seedStore = new SessionStore(TEST_DB, { journalMode: "DELETE" });
		seedStore.upsert({
			providerId: "mock",
			sdkSessionId: "sdk-old",
			title: "Old chat",
			model: "opus",
			source: "tui",
		});
		seedStore.setActiveSessionId("mock", "sdk-old");
		seedStore.setLastInteractiveAt(123);
		seedStore.setLastHandledRolloverInteractiveAt(123);
		seedStore.close();

		const facade = new RecordingFacade();
		const store = new SessionStore(TEST_DB, { journalMode: "DELETE" });
		const runtime = createAgentRuntime({
			agentId: "agent-railly",
			name: "railly",
			facade,
			promptHomeDir,
			rollover: { idleMinutes: 1 },
			store,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(facade.seenParams).toEqual([]);
		expect(store.getActiveSessionId("mock")).toBe("sdk-old");

		await runtime.stop();
		store.close();
	});

	test("delegates coding prompts to the daemon coding service without changing the active chat session", async () => {
		const chatFacade = new ProviderSessionFacade("claude", "claude-chat-123");
		const codingFacade = new ProviderSessionFacade("codex", "codex-code-456");
		const store = new SessionStore(TEST_DB, {
			agentId: "agent-railly",
			journalMode: "DELETE",
		});
		const codingSharedStore = new SessionStore(TEST_DB, {
			agentId: CODING_STORAGE_OWNER_ID,
			journalMode: "DELETE",
		});
		const codingStore = new CodingSessionStore(TEST_DB, {
			journalMode: "DELETE",
		});
		const codingRepositories = new CodingRepositoryStore(TEST_DB, {
			journalMode: "DELETE",
		});
		const codingEvents = new CodingSessionEventHub();
		const codingService = createCodingService({
			facade: codingFacade,
			repositories: codingRepositories,
			sessions: codingStore,
			events: codingEvents,
			sharedSessionStore: codingSharedStore,
		});
		const runtime = createAgentRuntime({
			agentId: "agent-railly",
			name: "railly",
			facade: chatFacade,
			coding: codingService.runtime,
			store,
		});
		const ws = mockWs();

		runtime.handleOpen(ws);
		runtime.handleMessage(
			ws,
			JSON.stringify({ type: "prompt", prompt: "chat turn" }),
		);
		await waitForDone(ws);

		expect(runtime.getStatusEvent()).toMatchObject({
			providerId: "claude",
			sessionId: "claude-chat-123",
		});
		expect(runtime.getActiveSessionId()).toBe("claude-chat-123");

		const codeResult = await runtime.coding.startPrompt({
			cwd: "/repo",
			linkedChatSessionId: runtime.getActiveSessionId(),
			prompt: "fix the tests",
		});

		expect(codeResult).toEqual({
			status: "accepted",
			providerId: "codex",
			sdkSessionId: "codex-code-456",
		});
		await waitForCondition(
			() => codingStore.get("codex", "codex-code-456")?.runStatus === "idle",
		);

		expect(chatFacade.seenParams.map((params) => params.prompt)).toEqual([
			"chat turn",
		]);
		expect(codingFacade.seenParams.map((params) => params.prompt)).toEqual([
			"fix the tests",
		]);
		expect(codingFacade.seenParams[0]).toMatchObject({
			cwd: "/repo",
		});
		// Code Mode runs use provider-default coding instructions; the runtime
		// must never overlay an Outclaw-constructed prompt on top of Codex's
		// default coding instructions.
		expect(codingFacade.seenParams[0]?.instructionPolicy?.mode).toBe(
			"provider_default",
		);
		expect(
			codingFacade.seenParams[0]?.instructionPolicy?.systemPrompt,
		).toBeUndefined();
		expect(codingSharedStore.get("codex", "codex-code-456")).toMatchObject({
			providerId: "codex",
			sdkSessionId: "codex-code-456",
			source: "code",
			tag: "code",
		});
		const repository = codingRepositories.list()[0];
		expect(repository).toMatchObject({
			rootCwd: "/repo",
			status: "active",
		});
		expect(codingStore.get("codex", "codex-code-456")).toMatchObject({
			repositoryId: repository?.id,
			providerId: "codex",
			sdkSessionId: "codex-code-456",
			cwd: "/repo",
			linkedChatSessionId: "claude-chat-123",
			lifecycleStatus: "open",
			runStatus: "idle",
		});

		await expect(
			runtime.coding.resumePrompt({
				providerId: "codex",
				sdkSessionId: "codex-code-456",
				prompt: "continue the fix",
			}),
		).resolves.toEqual({
			status: "accepted",
			providerId: "codex",
			sdkSessionId: "codex-code-456",
		});
		await waitForCondition(
			() => codingFacade.seenParams[1]?.prompt === "continue the fix",
		);
		expect(codingFacade.seenParams[1]).toMatchObject({
			cwd: "/repo",
			resume: "codex-code-456",
		});
		await waitForCondition(
			() => codingStore.get("codex", "codex-code-456")?.runStatus === "idle",
		);

		expect(runtime.getStatusEvent()).toMatchObject({
			providerId: "claude",
			sessionId: "claude-chat-123",
		});

		await runtime.stop();
		await codingService.stop();
		store.close();
		codingSharedStore.close();
		codingStore.close();
		codingRepositories.close();
		codingEvents.close();
	});

	test("selecting a Pi chat model starts and persists a pi session", async () => {
		const claudeFacade = new CatalogProviderSessionFacade(
			"claude",
			"claude-chat",
			[providerModel("sonnet", { isDefault: true })],
		);
		const piFacade = new CatalogProviderSessionFacade("pi", "pi-chat-789", [
			providerModel("anthropic/claude-sonnet-4-5", {
				model: "claude-sonnet-4-5",
				displayName: "Claude Sonnet 4.5",
			}),
		]);
		const store = new SessionStore(TEST_DB, {
			agentId: "agent-railly",
			journalMode: "DELETE",
		});
		const runtime = createAgentRuntime({
			agentId: "agent-railly",
			name: "railly",
			facade: claudeFacade,
			providers: [
				{ providerId: "claude", displayName: "Claude", facade: claudeFacade },
				{ providerId: "pi", displayName: "Pi", facade: piFacade },
			],
			defaultProviderId: "claude",
			defaultModel: "sonnet",
			store,
		});
		const ws = mockWs();

		expect(runtime.getStatusEvent().providerId).toBe("claude");
		runtime.handleOpen(ws);
		runtime.handleMessage(
			ws,
			JSON.stringify({
				type: "model_select",
				providerId: "pi",
				model: "anthropic/claude-sonnet-4-5",
				effort: "medium",
			}),
		);
		runtime.handleMessage(
			ws,
			JSON.stringify({ type: "prompt", prompt: "chat with Pi" }),
		);
		await waitForDone(ws);

		expect(claudeFacade.seenParams).toEqual([]);
		expect(piFacade.seenParams).toHaveLength(1);
		expect(piFacade.seenParams[0]).toMatchObject({
			model: "anthropic/claude-sonnet-4-5",
			effort: "medium",
			prompt: "chat with Pi",
		});
		expect(runtime.getStatusEvent()).toMatchObject({
			providerId: "pi",
			sessionId: "pi-chat-789",
		});
		expect(store.get("pi", "pi-chat-789")).toMatchObject({
			providerId: "pi",
			sdkSessionId: "pi-chat-789",
			model: "anthropic/claude-sonnet-4-5",
			source: "tui",
			tag: "chat",
		});

		await runtime.stop();
		store.close();
	});
});
