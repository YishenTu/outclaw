import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type {
	Facade,
	FacadeEvent,
	RunParams,
	ServerEvent,
} from "../../../src/common/protocol.ts";
import { createAgentRuntime } from "../../../src/runtime/application/create-agent-runtime.ts";
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

const TEST_DB = join(import.meta.dir, ".tmp-create-agent-runtime.sqlite");

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
			model: "opus",
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
			model: "opus",
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
});
