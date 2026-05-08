import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	DisplayImage,
	Facade,
	FacadeEvent,
	HistoryReplayEvent,
	ImageRef,
	RunParams,
	ServerEvent,
	TranscriptTurn,
} from "../../../src/common/protocol.ts";
import { createRuntimeController } from "../../../src/runtime/application/create-runtime-controller.ts";
import type { RuntimeController } from "../../../src/runtime/application/runtime-controller.ts";
import { SessionService } from "../../../src/runtime/application/session-service.ts";
import { RuntimeState } from "../../../src/runtime/application/state/runtime-state.ts";
import { SessionStore } from "../../../src/runtime/persistence/session-store/session-store.ts";
import type { WsClient } from "../../../src/runtime/transport/client-hub.ts";
import { MockFacade } from "../../helpers/mock-facade.ts";

const TEST_DB = join(import.meta.dir, ".tmp-runtime-controller.sqlite");
const IMAGE_TMP = mkdtempSync(join(tmpdir(), "mis-runtime-controller-"));
const PROVIDER_ID = "mock";

// Minimal WsClient stub — ClientHub only calls .send()
function mockWs(
	clientType: "telegram" | "tui" | "browser" = "tui",
): WsClient & { events: () => ServerEvent[] } {
	const sent: string[] = [];
	const ws = {
		data: { clientType },
		send: (data: string) => {
			sent.push(data);
		},
		events: () => sent.map((s) => JSON.parse(s) as ServerEvent),
	};
	return ws as unknown as WsClient & { events: () => ServerEvent[] };
}

function createController<TFacade extends Facade = MockFacade>(
	overrides: {
		facade?: TFacade;
		cwd?: string;
		deliverCronResult?: (params: {
			jobName: string;
			telegramChatId: number;
			text: string;
		}) => Promise<void> | void;
		deliverHeartbeatResult?: (params: {
			images: Array<{ path: string; caption?: string }>;
			telegramChatId: number;
			text: string;
		}) => Promise<void> | void;
		deliverRolloverNotice?: (params: {
			telegramChatId: number;
			text: string;
		}) => Promise<void> | void;
		autoTitle?: {
			model: string;
		};
		promptHomeDir?: string;
		store?: SessionStore;
		historyReader?: (id: string) => Promise<HistoryReplayEvent["messages"]>;
	} = {},
) {
	const facade = (overrides.facade ?? new MockFacade()) as TFacade;
	const state = new RuntimeState(facade.providerId);
	const sessions = new SessionService(state, overrides.store);
	if (overrides.historyReader) {
		(
			facade as Facade & {
				readHistory: (id: string) => Promise<HistoryReplayEvent["messages"]>;
			}
		).readHistory = overrides.historyReader;
	}
	return {
		facade,
		state,
		controller: createRuntimeController({
			facade,
			cwd: overrides.cwd,
			promptHomeDir: overrides.promptHomeDir,
			deliverCronResult: overrides.deliverCronResult,
			deliverHeartbeatResult: overrides.deliverHeartbeatResult,
			deliverRolloverNotice: overrides.deliverRolloverNotice,
			autoTitle: overrides.autoTitle,
			sessions,
			state,
		}),
	};
}

function prompt(
	text: string,
	source?: string,
	images?: ImageRef[],
	telegramChatId?: number,
	replyContext?: { text: string },
) {
	return JSON.stringify({
		type: "prompt",
		prompt: text,
		source,
		images,
		telegramChatId,
		replyContext,
	});
}

function command(cmd: string) {
	return JSON.stringify({ type: "command", command: cmd });
}

function requestSkills() {
	return JSON.stringify({ type: "request_skills" });
}

// Drain the internal message queue by sending a sentinel prompt and waiting for it
async function drain(
	controller: RuntimeController,
	facade: MockFacade,
): Promise<void> {
	const sentinel = mockWs();
	return new Promise<void>((resolve) => {
		const original = facade.delayMs;
		facade.delayMs = 0;
		const check = setInterval(() => {
			const events = sentinel.events();
			if (events.some((e) => e.type === "done")) {
				clearInterval(check);
				facade.delayMs = original;
				resolve();
			}
		}, 5);
		controller.handleMessage(sentinel, prompt("__drain__"));
	});
}

async function waitForDone(
	ws: WsClient & { events: () => ServerEvent[] },
): Promise<void> {
	await waitForDoneCount(ws, 1);
}

async function waitForDoneCount(
	ws: WsClient & { events: () => ServerEvent[] },
	count: number,
): Promise<void> {
	return new Promise<void>((resolve) => {
		const check = setInterval(() => {
			if (
				ws.events().filter((event) => event.type === "done").length >= count
			) {
				clearInterval(check);
				resolve();
			}
		}, 5);
	});
}

async function waitForServerEvent(
	ws: WsClient & { events: () => ServerEvent[] },
	type: ServerEvent["type"],
): Promise<ServerEvent> {
	return new Promise<ServerEvent>((resolve, reject) => {
		const timeout = setTimeout(() => {
			clearInterval(check);
			reject(new Error(`Timed out waiting for ${type}`));
		}, 1_000);
		const check = setInterval(() => {
			const event = ws.events().find((candidate) => candidate.type === type);
			if (event) {
				clearTimeout(timeout);
				clearInterval(check);
				resolve(event);
			}
		}, 5);
	});
}

async function waitForCondition(assertion: () => boolean): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => {
			clearInterval(check);
			reject(new Error("Timed out waiting for condition"));
		}, 1_000);
		const check = setInterval(() => {
			if (assertion()) {
				clearTimeout(timeout);
				clearInterval(check);
				resolve();
			}
		}, 5);
	});
}

function cleanupStore(path: string) {
	if (existsSync(path)) rmSync(path);
	if (existsSync(`${path}-wal`)) rmSync(`${path}-wal`);
	if (existsSync(`${path}-shm`)) rmSync(`${path}-shm`);
}

function createImagePath(name: string): string {
	const path = join(IMAGE_TMP, name);
	writeFileSync(path, "bytes");
	return path;
}

function createDeferred() {
	let resolve: () => void = () => {};
	const promise = new Promise<void>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

class BlockingFacade implements Facade {
	providerId = PROVIDER_ID;
	started = createDeferred();
	release = createDeferred();

	async *run(): AsyncIterable<FacadeEvent> {
		this.started.resolve();
		await this.release.promise;
		yield { type: "text", text: "done" };
		yield {
			type: "done",
			sessionId: "blocking-session",
			durationMs: 1,
		};
	}
}

class AbortErrorFacade implements Facade {
	providerId = PROVIDER_ID;
	started = createDeferred();
	lastParams: RunParams | undefined;

	async *run(params: RunParams): AsyncIterable<FacadeEvent> {
		this.lastParams = params;
		this.started.resolve();
		await new Promise<void>((resolve) => {
			params.abortController?.signal.addEventListener(
				"abort",
				() => resolve(),
				{
					once: true,
				},
			);
		});
		yield { type: "error", message: "AbortError: operation aborted" };
	}
}

class AutoTitleFacade implements Facade {
	providerId = PROVIDER_ID;
	allParams: RunParams[] = [];
	mainSessionId = "sdk-auto-main";
	titleError: string | undefined;
	titleText = '"WebSocket routing bug?"';
	private readonly titleRelease = createDeferred();
	private readonly titleSettled = createDeferred();

	constructor(private readonly delayTitle = false) {}

	get titleCalls(): RunParams[] {
		return this.allParams.filter((params) => params.tools?.length === 0);
	}

	releaseTitle() {
		this.titleRelease.resolve();
	}

	waitForTitleSettled(): Promise<void> {
		return this.titleSettled.promise;
	}

	async *run(params: RunParams): AsyncIterable<FacadeEvent> {
		this.allParams.push({ ...params });

		if (params.tools?.length === 0) {
			if (this.delayTitle) {
				await this.titleRelease.promise;
			}
			if (this.titleError) {
				yield { type: "error", message: this.titleError };
				this.titleSettled.resolve();
				return;
			}
			yield { type: "text", text: this.titleText };
			yield {
				type: "done",
				sessionId: "ephemeral-title-session",
				durationMs: 1,
			};
			this.titleSettled.resolve();
			return;
		}

		yield { type: "text", text: "main answer" };
		yield {
			type: "done",
			sessionId: this.mainSessionId,
			durationMs: 1,
		};
	}
}

class ShutdownAutoTitleFacade implements Facade {
	providerId = PROVIDER_ID;
	allParams: RunParams[] = [];
	titleAbortObserved = false;
	private readonly titleRelease = createDeferred();
	private readonly titleSettled = createDeferred();

	get titleCalls(): RunParams[] {
		return this.allParams.filter((params) => params.tools?.length === 0);
	}

	releaseTitle() {
		this.titleRelease.resolve();
	}

	waitForTitleSettled(): Promise<void> {
		return this.titleSettled.promise;
	}

	async *run(params: RunParams): AsyncIterable<FacadeEvent> {
		this.allParams.push({ ...params });

		if (params.tools?.length === 0) {
			try {
				if (params.abortController?.signal.aborted) {
					this.titleAbortObserved = true;
					this.titleRelease.resolve();
				} else {
					params.abortController?.signal.addEventListener(
						"abort",
						() => {
							this.titleAbortObserved = true;
							this.titleRelease.resolve();
						},
						{ once: true },
					);
				}
				await this.titleRelease.promise;
				if (this.titleAbortObserved) {
					return;
				}
				yield { type: "text", text: "Shutdown title" };
				yield {
					type: "done",
					sessionId: "ephemeral-title-session",
					durationMs: 1,
				};
				return;
			} finally {
				this.titleSettled.resolve();
			}
		}

		yield { type: "text", text: "main answer" };
		yield {
			type: "done",
			sessionId: "sdk-auto-main",
			durationMs: 1,
		};
	}
}

class EarlySessionAutoTitleFacade implements Facade {
	providerId = PROVIDER_ID;
	allParams: RunParams[] = [];
	private readonly mainRelease = createDeferred();
	private readonly titleSettled = createDeferred();

	get titleCalls(): RunParams[] {
		return this.allParams.filter((params) => params.tools?.length === 0);
	}

	releaseMain() {
		this.mainRelease.resolve();
	}

	waitForTitleSettled(): Promise<void> {
		return this.titleSettled.promise;
	}

	async *run(params: RunParams): AsyncIterable<FacadeEvent> {
		this.allParams.push({ ...params });

		if (params.tools?.length === 0) {
			try {
				yield { type: "text", text: "Early generated title" };
				yield {
					type: "done",
					sessionId: "ephemeral-title-session",
					durationMs: 1,
				};
				return;
			} finally {
				this.titleSettled.resolve();
			}
		}

		yield {
			type: "session_initialized",
			sessionId: "sdk-early-main",
		} as FacadeEvent;
		await this.mainRelease.promise;
		yield { type: "text", text: "main answer" };
		yield {
			type: "done",
			sessionId: "sdk-early-main",
			durationMs: 1,
		};
	}
}

class SessionAwareBlockingFacade implements Facade {
	providerId = PROVIDER_ID;
	allParams: Array<{ abortController?: AbortController; resume?: string }> = [];
	doneUsage = {
		inputTokens: 3,
		outputTokens: 5,
		cacheCreationTokens: 0,
		cacheReadTokens: 0,
		contextWindow: 200_000,
		maxOutputTokens: 8_000,
		contextTokens: 8,
		percentage: 0.004,
	};
	private readonly releaseBySession = new Map<
		string,
		ReturnType<typeof createDeferred>
	>();
	private readonly startedBySession = new Map<
		string,
		ReturnType<typeof createDeferred>
	>();

	waitStarted(sessionId: string): Promise<void> {
		return this.getStarted(sessionId).promise;
	}

	release(sessionId: string) {
		this.getRelease(sessionId).resolve();
	}

	async *run(params: RunParams): AsyncIterable<FacadeEvent> {
		const sessionId = params.resume ?? "new-session";
		this.allParams.push({
			abortController: params.abortController,
			resume: params.resume,
		});
		this.getStarted(sessionId).resolve();
		await this.getRelease(sessionId).promise;
		yield { type: "text", text: `done ${sessionId}` };
		yield {
			type: "done",
			sessionId,
			durationMs: 1,
			usage: this.doneUsage,
		};
	}

	private getRelease(sessionId: string) {
		const existing = this.releaseBySession.get(sessionId);
		if (existing) {
			return existing;
		}
		const next = createDeferred();
		this.releaseBySession.set(sessionId, next);
		return next;
	}

	private getStarted(sessionId: string) {
		const existing = this.startedBySession.get(sessionId);
		if (existing) {
			return existing;
		}
		const next = createDeferred();
		this.startedBySession.set(sessionId, next);
		return next;
	}
}

class SessionAwareStreamingFacade implements Facade {
	providerId = PROVIDER_ID;
	private readonly firstChunkBySession = new Map<
		string,
		ReturnType<typeof createDeferred>
	>();
	private readonly releaseBySession = new Map<
		string,
		ReturnType<typeof createDeferred>
	>();

	waitForFirstChunk(sessionId: string): Promise<void> {
		return this.getFirstChunk(sessionId).promise;
	}

	release(sessionId: string) {
		this.getRelease(sessionId).resolve();
	}

	async *run(params: RunParams): AsyncIterable<FacadeEvent> {
		const sessionId = params.resume ?? "new-session";
		yield { type: "text", text: `partial ${sessionId}` };
		this.getFirstChunk(sessionId).resolve();
		await this.getRelease(sessionId).promise;
		yield { type: "text", text: ` later ${sessionId}` };
		yield {
			type: "done",
			sessionId,
			durationMs: 1,
		};
	}

	private getFirstChunk(sessionId: string) {
		const existing = this.firstChunkBySession.get(sessionId);
		if (existing) {
			return existing;
		}
		const next = createDeferred();
		this.firstChunkBySession.set(sessionId, next);
		return next;
	}

	private getRelease(sessionId: string) {
		const existing = this.releaseBySession.get(sessionId);
		if (existing) {
			return existing;
		}
		const next = createDeferred();
		this.releaseBySession.set(sessionId, next);
		return next;
	}
}

describe("RuntimeController", () => {
	describe("client lifecycle", () => {
		test("handleOpen hides heartbeat timer when no session is active", async () => {
			const { controller } = createController();
			controller.setHeartbeatInfoProvider(() => ({
				nextHeartbeatAt: 123_456,
				deferred: false,
			}));
			const ws = mockWs();

			controller.handleOpen(ws);
			await new Promise((r) => setTimeout(r, 20));

			const status = ws
				.events()
				.find((event) => event.type === "runtime_status") as
				| { nextHeartbeatAt?: number }
				| undefined;
			expect(status).toBeDefined();
			expect(status?.nextHeartbeatAt).toBeUndefined();
		});

		test("handleOpen replays history when session is active", async () => {
			const historyReader = async (_id: string) => [
				{
					kind: "chat" as const,
					role: "user" as const,
					content: "past question",
				},
				{
					kind: "chat" as const,
					role: "assistant" as const,
					content: "past answer",
				},
			];
			const { controller, facade } = createController({ historyReader });
			const ws1 = mockWs();

			// Establish an active session first
			controller.handleOpen(ws1);
			controller.handleMessage(ws1, prompt("hello"));
			await drain(controller, facade);

			// New client connects — should receive history_replay
			const ws2 = mockWs();
			controller.handleOpen(ws2);
			// Give async replayHistory time to resolve
			await new Promise((r) => setTimeout(r, 20));

			const replay = ws2.events().find((e) => e.type === "history_replay");
			expect(replay).toBeDefined();
			expect((replay as { sdkSessionId?: string }).sdkSessionId).toBe(
				"mock-session-123",
			);
			expect((replay as { messages: unknown[] }).messages).toHaveLength(2);
		});

		test("handleOpen does not replay when no active session", async () => {
			const historyReader = async (_id: string) => [
				{
					kind: "chat" as const,
					role: "user" as const,
					content: "should not appear",
				},
			];
			const { controller } = createController({ historyReader });
			const ws = mockWs();

			controller.handleOpen(ws);
			await new Promise((r) => setTimeout(r, 20));

			const events = ws.events().filter((e) => e.type !== "runtime_status");
			expect(events).toHaveLength(0);
		});

		test("handleClose removes client so it no longer receives events", async () => {
			const { controller, facade } = createController();
			const ws1 = mockWs();
			const ws2 = mockWs();

			controller.handleOpen(ws1);
			controller.handleOpen(ws2);
			controller.handleClose(ws2);

			// Telegram broadcast should only reach ws1 (sender gets events directly)
			controller.handleMessage(ws1, prompt("hi", "telegram"));
			await drain(controller, facade);

			// ws2 should have no events after being removed (except initial status)
			const ws2Events = ws2.events().filter((e) => e.type !== "runtime_status");
			expect(ws2Events).toHaveLength(0);
		});
	});

	describe("message routing", () => {
		test("invalid JSON sends error to sender", () => {
			const { controller } = createController();
			const ws = mockWs();
			controller.handleOpen(ws);

			controller.handleMessage(ws, "not json{{{");

			const events = ws.events().filter((e) => e.type !== "runtime_status");
			expect(events).toHaveLength(1);
			expect(events[0]?.type).toBe("error");
		});

		test("request_skills sends skills_update when facade supports it", async () => {
			const facade = {
				providerId: "mock",
				run: async function* () {},
				getSkills: async (cwd?: string) => [
					{ name: "commit", description: `cwd=${cwd ?? "none"}` },
				],
			};
			const state = new RuntimeState(facade.providerId);
			const sessions = new SessionService(state);
			const controller = createRuntimeController({
				facade,
				cwd: "/tmp/outclaw",
				sessions,
				state,
			});
			const ws = mockWs();
			controller.handleOpen(ws);

			controller.handleMessage(ws, requestSkills());
			await new Promise((resolve) => setTimeout(resolve, 0));

			const update = ws
				.events()
				.find((event) => event.type === "skills_update");
			expect(update).toEqual({
				type: "skills_update",
				skills: [{ name: "commit", description: "cwd=/tmp/outclaw" }],
			});
		});

		test("request_skills is ignored when facade does not expose skills", async () => {
			const { controller } = createController();
			const ws = mockWs();
			controller.handleOpen(ws);

			controller.handleMessage(ws, requestSkills());
			await new Promise((resolve) => setTimeout(resolve, 0));

			const updates = ws
				.events()
				.filter((event) => event.type === "skills_update");
			expect(updates).toHaveLength(0);
		});

		test("request_skills reports backend failures to the requester", async () => {
			const facade = {
				providerId: "mock",
				run: async function* () {},
				getSkills: async () => {
					throw new Error("skills lookup failed");
				},
			};
			const state = new RuntimeState(facade.providerId);
			const sessions = new SessionService(state);
			const controller = createRuntimeController({
				facade,
				sessions,
				state,
			});
			const ws = mockWs();
			controller.handleOpen(ws);

			controller.handleMessage(ws, requestSkills());
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(ws.events()).toContainEqual({
				type: "error",
				message: "skills lookup failed",
			});
		});

		test("command message routes to command handler", async () => {
			const { controller } = createController();
			const ws = mockWs();
			controller.handleOpen(ws);

			controller.handleMessage(ws, command("/status"));
			await new Promise((r) => setTimeout(r, 10));

			const events = ws.events();
			expect(events.some((e) => e.type === "runtime_status")).toBe(true);
		});

		test("prompt message calls facade.run()", async () => {
			const { controller, facade } = createController();
			const ws = mockWs();
			controller.handleOpen(ws);

			controller.handleMessage(ws, prompt("hello"));
			await drain(controller, facade);

			expect(facade.callCount).toBe(2); // "hello" + drain sentinel
			expect(facade.callOrder[0]).toBe("hello");
		});
	});

	describe("prompt execution", () => {
		test("systemPrompt is undefined when promptHomeDir is not set", async () => {
			const { controller, facade } = createController();
			const ws = mockWs();
			controller.handleOpen(ws);

			controller.handleMessage(ws, prompt("hello"));
			await drain(controller, facade);

			const call = facade.allParams.find((p) => p.prompt === "hello");
			expect(call?.systemPrompt).toBeUndefined();
		});

		test("passes systemPrompt to facade", async () => {
			const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
			const { tmpdir } = await import("node:os");
			const { join } = await import("node:path");

			const tmp = mkdtempSync(join(tmpdir(), "mis-test-"));
			try {
				writeFileSync(join(tmp, "AGENTS.md"), "be helpful");

				const { controller, facade } = createController({
					promptHomeDir: tmp,
				});
				const ws = mockWs();
				controller.handleOpen(ws);

				controller.handleMessage(ws, prompt("hello"));
				await drain(controller, facade);

				const call = facade.allParams.find((p) => p.prompt === "hello");
				expect(call?.systemPrompt).toBeDefined();
				expect(call?.systemPrompt).toContain("be helpful");
				expect(call?.systemPrompt).toContain("<agents>");
			} finally {
				rmSync(tmp, { recursive: true });
			}
		});

		test("passes cwd to facade", async () => {
			const { controller, facade } = createController({
				cwd: "/test/project",
			});
			const ws = mockWs();
			controller.handleOpen(ws);

			controller.handleMessage(ws, prompt("hi"));
			await drain(controller, facade);

			expect(facade.lastParams?.cwd).toBe("/test/project");
		});

		test("passes model and effort to facade", async () => {
			const { controller, facade } = createController();
			const ws = mockWs();
			controller.handleOpen(ws);

			// Switch to haiku + max effort
			controller.handleMessage(ws, command("/model haiku"));
			controller.handleMessage(ws, command("/thinking max"));
			await new Promise((r) => setTimeout(r, 10));

			controller.handleMessage(ws, prompt("test"));
			await drain(controller, facade);

			const testCall = facade.allParams.find((p) => p.prompt === "test");
			expect(testCall).toBeDefined();
			expect(testCall?.model).toBe("haiku");
			expect(testCall?.effort).toBe("max");
		});

		test("streams facade events to sender", async () => {
			const { controller, facade } = createController();
			const ws = mockWs();
			controller.handleOpen(ws);

			controller.handleMessage(ws, prompt("hello"));
			await drain(controller, facade);

			const events = ws.events();
			const textEvents = events.filter((e) => e.type === "text");
			const doneEvents = events.filter((e) => e.type === "done");

			expect(textEvents.length).toBeGreaterThanOrEqual(1);
			expect(doneEvents.length).toBeGreaterThanOrEqual(1);
		});

		test("streams image events to sender", async () => {
			const facade = new MockFacade();
			const imagePath = createImagePath("sender-chart.png");
			facade.textChunks = [`Saved chart to ${imagePath}`];
			const { controller } = createController({ facade });
			const ws = mockWs();
			controller.handleOpen(ws);

			controller.handleMessage(ws, prompt("plot"));
			await drain(controller, facade);

			const imageEvents = ws.events().filter((event) => event.type === "image");
			expect(imageEvents).toEqual([{ type: "image", path: imagePath }]);
		});

		test("resumes session on subsequent prompts", async () => {
			const { controller, facade } = createController();
			const ws = mockWs();
			controller.handleOpen(ws);

			// First prompt — no resume yet
			controller.handleMessage(ws, prompt("first"));
			await drain(controller, facade);

			const firstCall = facade.allParams.find((p) => p.prompt === "first");
			expect(firstCall?.resume).toBeUndefined();

			// Second prompt — should resume with session ID from done event
			controller.handleMessage(ws, prompt("second"));
			await drain(controller, facade);

			const secondCall = facade.allParams.find((p) => p.prompt === "second");
			expect(secondCall?.resume).toBe("mock-session-123");
		});

		test("sets session title from first prompt", async () => {
			cleanupStore(TEST_DB);
			const store = new SessionStore(TEST_DB, { journalMode: "DELETE" });
			const { controller, facade } = createController({ store });
			const ws = mockWs();
			controller.handleOpen(ws);

			controller.handleMessage(ws, prompt("What is the meaning of life?"));
			await drain(controller, facade);

			// Check via /session command — now returns session_menu
			controller.handleMessage(ws, command("/session"));
			await new Promise((r) => setTimeout(r, 10));

			const events = ws.events();
			const menu = events.find((e) => e.type === "session_menu") as
				| { sessions: Array<{ title: string }> }
				| undefined;
			expect(menu).toBeDefined();
			expect(menu?.sessions[0]?.title).toBe("What is the meaning of life?");
			store.close();
			cleanupStore(TEST_DB);
		});

		test("auto-generates a persisted title for the first text prompt and broadcasts the rename", async () => {
			cleanupStore(TEST_DB);
			const store = new SessionStore(TEST_DB, { journalMode: "DELETE" });
			const facade = new AutoTitleFacade();
			const { controller } = createController({
				autoTitle: { model: "haiku" },
				facade,
				store,
			});
			const tui = mockWs("tui");
			const browser = mockWs("browser");
			controller.handleOpen(tui);
			controller.handleOpen(browser);

			controller.handleMessage(
				tui,
				prompt(
					"Explain websocket routing bugs in the browser sidebar",
					undefined,
					[{ path: "/tmp/ignored.png", mediaType: "image/png" }],
					undefined,
					{ text: "reply context is ignored for titles" },
				),
			);
			await waitForDone(tui);
			const renamed = await waitForServerEvent(browser, "session_renamed");

			expect(renamed).toEqual({
				type: "session_renamed",
				sdkSessionId: "sdk-auto-main",
				title: "WebSocket routing bug",
				providerId: PROVIDER_ID,
				active: true,
			});
			expect(store.get(PROVIDER_ID, "sdk-auto-main")).toMatchObject({
				title: "WebSocket routing bug",
				autoTitleAttempted: true,
			});
			expect(facade.titleCalls).toHaveLength(1);
			expect(facade.titleCalls[0]).toMatchObject({
				model: "haiku",
				effort: "low",
				stream: false,
				tools: [],
				ephemeral: true,
			});
			expect(facade.titleCalls[0]?.prompt).toContain(
				"Do not answer the request",
			);
			expect(facade.titleCalls[0]?.prompt).toContain(
				"<request>\nExplain websocket routing bugs in the browser sidebar\n</request>",
			);
			expect(facade.titleCalls[0]?.images).toBeUndefined();
			expect(facade.titleCalls[0]?.replyContext).toBeUndefined();
			expect(facade.titleCalls[0]?.systemPrompt).toContain(
				"Generate a 3-6 word title",
			);
			const latestStatus = browser
				.events()
				.filter((event) => event.type === "runtime_status")
				.at(-1) as { sessionTitle?: string } | undefined;
			expect(latestStatus?.sessionTitle).toBe("WebSocket routing bug");

			store.close();
			cleanupStore(TEST_DB);
		});

		test("keeps New conversation visible while auto-title is pending", async () => {
			cleanupStore(TEST_DB);
			const store = new SessionStore(TEST_DB, { journalMode: "DELETE" });
			const facade = new AutoTitleFacade(true);
			facade.titleText = "Generated title";
			const { controller } = createController({
				autoTitle: { model: "haiku" },
				facade,
				store,
			});
			const ws = mockWs("browser");
			controller.handleOpen(ws);

			controller.handleMessage(ws, prompt("Summarize the config panel bug"));
			await waitForDone(ws);
			await waitForCondition(() => facade.titleCalls.length === 1);

			expect(store.get(PROVIDER_ID, "sdk-auto-main")).toMatchObject({
				title: "New conversation",
				autoTitleAttempted: false,
			});
			const pendingStatus = ws
				.events()
				.filter((event) => event.type === "runtime_status")
				.at(-1) as { sessionTitle?: string } | undefined;
			expect(pendingStatus?.sessionTitle).toBeUndefined();

			facade.releaseTitle();
			const renamed = await waitForServerEvent(ws, "session_renamed");
			expect(renamed).toMatchObject({
				sdkSessionId: "sdk-auto-main",
				title: "Generated title",
				active: true,
			});

			store.close();
			cleanupStore(TEST_DB);
		});

		test("auto-title skips image-only first prompts", async () => {
			cleanupStore(TEST_DB);
			const store = new SessionStore(TEST_DB, { journalMode: "DELETE" });
			const facade = new AutoTitleFacade();
			const { controller } = createController({
				autoTitle: { model: "haiku" },
				facade,
				store,
			});
			const ws = mockWs();
			controller.handleOpen(ws);

			controller.handleMessage(
				ws,
				prompt("", undefined, [
					{ path: "/tmp/cat.png", mediaType: "image/png" },
				]),
			);
			await waitForDone(ws);

			expect(facade.titleCalls).toHaveLength(0);
			expect(store.get(PROVIDER_ID, "sdk-auto-main")).toMatchObject({
				title: "Image",
				autoTitleAttempted: false,
			});

			store.close();
			cleanupStore(TEST_DB);
		});

		test("auto-title does not run again on resumed prompts", async () => {
			cleanupStore(TEST_DB);
			const store = new SessionStore(TEST_DB, { journalMode: "DELETE" });
			const facade = new AutoTitleFacade();
			const { controller } = createController({
				autoTitle: { model: "haiku" },
				facade,
				store,
			});
			const ws = mockWs();
			controller.handleOpen(ws);

			controller.handleMessage(ws, prompt("Explain the first request"));
			await waitForDone(ws);
			await waitForCondition(
				() =>
					store.get(PROVIDER_ID, "sdk-auto-main")?.autoTitleAttempted === true,
			);
			controller.handleMessage(ws, prompt("Follow up on that"));
			await waitForDoneCount(ws, 2);

			expect(facade.titleCalls).toHaveLength(1);
			expect(
				facade.allParams.find((params) => params.prompt === "Follow up on that")
					?.resume,
			).toBe("sdk-auto-main");

			store.close();
			cleanupStore(TEST_DB);
		});

		test("auto-title failure preserves the fallback title and records the attempt", async () => {
			cleanupStore(TEST_DB);
			const store = new SessionStore(TEST_DB, { journalMode: "DELETE" });
			const facade = new AutoTitleFacade();
			facade.titleError = "title failed";
			const { controller } = createController({
				autoTitle: { model: "haiku" },
				facade,
				store,
			});
			const ws = mockWs();
			controller.handleOpen(ws);

			controller.handleMessage(
				ws,
				prompt("Write release notes for the sidebar"),
			);
			await waitForDone(ws);
			await waitForCondition(
				() =>
					store.get(PROVIDER_ID, "sdk-auto-main")?.autoTitleAttempted === true,
			);

			expect(store.get(PROVIDER_ID, "sdk-auto-main")).toMatchObject({
				title: "Write release notes for the sidebar",
				autoTitleAttempted: true,
			});
			expect(
				ws.events().find((event) => event.type === "session_renamed"),
			).toMatchObject({
				type: "session_renamed",
				sdkSessionId: "sdk-auto-main",
				title: "Write release notes for the sidebar",
				providerId: PROVIDER_ID,
				active: true,
			});

			store.close();
			cleanupStore(TEST_DB);
		});

		test("manual rename wins over a late auto-title result", async () => {
			cleanupStore(TEST_DB);
			const store = new SessionStore(TEST_DB, { journalMode: "DELETE" });
			const facade = new AutoTitleFacade(true);
			facade.titleText = "Generated title";
			const { controller } = createController({
				autoTitle: { model: "haiku" },
				facade,
				store,
			});
			const ws = mockWs();
			controller.handleOpen(ws);

			controller.handleMessage(ws, prompt("Summarize the config panel bug"));
			await waitForDone(ws);
			controller.handleMessage(
				ws,
				command("/session rename sdk-auto-main Manual title"),
			);
			await waitForServerEvent(ws, "session_renamed");
			await waitForCondition(() => facade.titleCalls.length === 1);
			facade.releaseTitle();
			await waitForCondition(
				() =>
					store.get(PROVIDER_ID, "sdk-auto-main")?.autoTitleAttempted === true,
			);

			expect(store.get(PROVIDER_ID, "sdk-auto-main")).toMatchObject({
				title: "Manual title",
				autoTitleAttempted: true,
			});
			expect(
				ws.events().filter((event) => event.type === "session_renamed"),
			).toEqual([
				{
					type: "session_renamed",
					sdkSessionId: "sdk-auto-main",
					title: "Manual title",
					providerId: PROVIDER_ID,
					active: true,
				},
			]);

			store.close();
			cleanupStore(TEST_DB);
		});

		test("delayed auto-title renames persisted sessions after /new without reactivating them", async () => {
			cleanupStore(TEST_DB);
			const store = new SessionStore(TEST_DB, { journalMode: "DELETE" });
			const facade = new AutoTitleFacade(true);
			facade.titleText = "Generated title";
			const { controller } = createController({
				autoTitle: { model: "haiku" },
				facade,
				store,
			});
			const tui = mockWs("tui");
			const browser = mockWs("browser");
			controller.handleOpen(tui);
			controller.handleOpen(browser);

			controller.handleMessage(tui, prompt("Summarize the config panel bug"));
			await waitForDone(tui);
			controller.handleMessage(tui, command("/new"));
			await waitForServerEvent(browser, "session_cleared");
			await waitForCondition(() => facade.titleCalls.length === 1);
			facade.releaseTitle();
			const renamed = await waitForServerEvent(browser, "session_renamed");

			expect(renamed).toEqual({
				type: "session_renamed",
				sdkSessionId: "sdk-auto-main",
				title: "Generated title",
				providerId: PROVIDER_ID,
				active: false,
			});
			expect(store.get(PROVIDER_ID, "sdk-auto-main")).toMatchObject({
				title: "Generated title",
				autoTitleAttempted: true,
			});
			const latestStatus = browser
				.events()
				.filter((event) => event.type === "runtime_status")
				.at(-1) as { sessionId?: string; sessionTitle?: string } | undefined;
			expect(latestStatus?.sessionId).toBeUndefined();
			expect(latestStatus?.sessionTitle).toBeUndefined();

			store.close();
			cleanupStore(TEST_DB);
		});

		test("auto-title can bind to an initialized session before the main run completes", async () => {
			cleanupStore(TEST_DB);
			const store = new SessionStore(TEST_DB, { journalMode: "DELETE" });
			const facade = new EarlySessionAutoTitleFacade();
			const { controller } = createController({
				autoTitle: { model: "haiku" },
				facade,
				store,
			});
			const ws = mockWs("tui");
			controller.handleOpen(ws);

			try {
				controller.handleMessage(ws, prompt("Explain early session binding"));
				await facade.waitForTitleSettled();
				await waitForCondition(
					() =>
						store.get(PROVIDER_ID, "sdk-early-main")?.title ===
						"Early generated title",
				);

				expect(ws.events().some((event) => event.type === "done")).toBe(false);
				expect(store.get(PROVIDER_ID, "sdk-early-main")).toMatchObject({
					title: "Early generated title",
					autoTitleAttempted: true,
				});
			} finally {
				facade.releaseMain();
				await waitForDone(ws);
				store.close();
				cleanupStore(TEST_DB);
			}
		});

		test("failed delayed auto-title marks the persisted session after /new", async () => {
			cleanupStore(TEST_DB);
			const store = new SessionStore(TEST_DB, { journalMode: "DELETE" });
			const facade = new AutoTitleFacade(true);
			facade.titleError = "title failed";
			const { controller } = createController({
				autoTitle: { model: "haiku" },
				facade,
				store,
			});
			const ws = mockWs("tui");
			controller.handleOpen(ws);

			controller.handleMessage(
				ws,
				prompt("Write release notes for the sidebar"),
			);
			await waitForDone(ws);
			controller.handleMessage(ws, command("/new"));
			await waitForServerEvent(ws, "session_cleared");
			await waitForCondition(() => facade.titleCalls.length === 1);
			facade.releaseTitle();
			const renamed = await waitForServerEvent(ws, "session_renamed");

			expect(renamed).toEqual({
				type: "session_renamed",
				sdkSessionId: "sdk-auto-main",
				title: "Write release notes for the sidebar",
				providerId: PROVIDER_ID,
				active: false,
			});
			expect(store.get(PROVIDER_ID, "sdk-auto-main")).toMatchObject({
				title: "Write release notes for the sidebar",
				autoTitleAttempted: true,
			});

			store.close();
			cleanupStore(TEST_DB);
		});

		test("refreshes transcript search snapshots after a successful run completes", async () => {
			cleanupStore(TEST_DB);
			const store = new SessionStore(TEST_DB, { journalMode: "DELETE" });
			const facade = new MockFacade();
			(
				facade as unknown as Facade & {
					readTranscript: (id: string) => Promise<TranscriptTurn[]>;
				}
			).readTranscript = async (id: string) => {
				expect(id).toBe("mock-session-123");
				return [
					{
						role: "user",
						content: "find the webhook notes",
						timestamp: 100,
					},
				];
			};
			const { controller } = createController({ facade, store });
			const ws = mockWs();
			controller.handleOpen(ws);

			controller.handleMessage(ws, prompt("hello"));
			await drain(controller, facade);

			const db = new Database(TEST_DB, { readonly: true });
			expect(
				db
					.query(
						`SELECT role, body_text, timestamp
							 FROM transcript_turns
							 WHERE agent_id = $agentId
							   AND provider_id = $providerId
							   AND sdk_session_id = $id`,
					)
					.all({
						$agentId: "agent-default",
						$providerId: PROVIDER_ID,
						$id: "mock-session-123",
					}),
			).toEqual([
				{
					role: "user",
					body_text: "find the webhook notes",
					timestamp: 100,
				},
			]);
			db.close();
			store.close();
			cleanupStore(TEST_DB);
		});

		test("sets session title for an image-only prompt", async () => {
			cleanupStore(TEST_DB);
			const store = new SessionStore(TEST_DB, { journalMode: "DELETE" });
			const { controller, facade } = createController({ store });
			const ws = mockWs();
			controller.handleOpen(ws);

			controller.handleMessage(
				ws,
				prompt("", undefined, [
					{ path: "/tmp/cat.png", mediaType: "image/png" },
				]),
			);
			await drain(controller, facade);

			controller.handleMessage(ws, command("/session"));
			await new Promise((r) => setTimeout(r, 10));

			const menu = ws.events().find((e) => e.type === "session_menu") as
				| { sessions: Array<{ title: string }> }
				| undefined;
			expect(menu?.sessions[0]?.title).toBe("Image");
			store.close();
			cleanupStore(TEST_DB);
		});

		test("accepts image-only prompts and forwards images to the facade", async () => {
			const { controller, facade } = createController();
			const ws = mockWs();
			controller.handleOpen(ws);

			const images: ImageRef[] = [
				{ path: "/tmp/cat.png", mediaType: "image/png" },
			];
			controller.handleMessage(ws, prompt("", undefined, images));
			await drain(controller, facade);

			expect(facade.allParams[0]?.prompt).toBe("");
			expect(facade.allParams[0]?.images).toEqual(images);
		});
	});

	describe("telegram broadcast", () => {
		test("broadcasts running runtime_status while an observed telegram run is active", async () => {
			const facade = new BlockingFacade();
			const state = new RuntimeState(facade.providerId);
			const sessions = new SessionService(state);
			const controller = createRuntimeController({
				facade,
				sessions,
				state,
			});
			const tui = mockWs("tui");
			const tg = mockWs("telegram");

			controller.handleOpen(tui);
			controller.handleOpen(tg);
			controller.handleMessage(tg, prompt("hi from tg", "telegram"));

			await facade.started.promise;

			const runningStatus = tui
				.events()
				.filter((event) => event.type === "runtime_status")
				.at(-1) as { running?: boolean } | undefined;
			expect(runningStatus?.running).toBe(true);

			facade.release.resolve();
			await waitForDone(tg);

			const completedStatus = tui
				.events()
				.filter((event) => event.type === "runtime_status")
				.at(-1) as { running?: boolean; sessionId?: string } | undefined;
			expect(completedStatus).toMatchObject({
				running: false,
				sessionId: "blocking-session",
			});
		});

		test("late tui observers receive live events from an active telegram run", async () => {
			const facade = new BlockingFacade();
			const state = new RuntimeState(facade.providerId);
			const sessions = new SessionService(state);
			const controller = createRuntimeController({
				facade,
				sessions,
				state,
			});
			const tg = mockWs("telegram");
			controller.handleOpen(tg);
			controller.handleMessage(tg, prompt("hi from tg", "telegram"));

			await facade.started.promise;

			const tui = mockWs("tui");
			controller.handleOpen(tui);
			await new Promise((resolve) => setTimeout(resolve, 20));

			facade.release.resolve();
			await waitForDone(tg);
			await new Promise((resolve) => setTimeout(resolve, 20));

			expect(tui.events().some((event) => event.type === "text")).toBe(true);
			expect(tui.events().some((event) => event.type === "done")).toBe(true);
		});

		test("broadcasts user_prompt and events to other clients", async () => {
			const { controller, facade } = createController();
			const tui = mockWs();
			const tg = mockWs();

			controller.handleOpen(tui);
			controller.handleOpen(tg);

			controller.handleMessage(tg, prompt("hi from tg", "telegram"));
			await drain(controller, facade);

			const tuiEvents = tui.events();
			const userPrompt = tuiEvents.find((e) => e.type === "user_prompt");
			expect(userPrompt).toBeDefined();

			const tuiText = tuiEvents.filter((e) => e.type === "text");
			expect(tuiText.length).toBeGreaterThanOrEqual(1);
		});

		test("broadcasts user_prompt and events to browser observers", async () => {
			const { controller, facade } = createController();
			const browser = mockWs("browser");
			const tg = mockWs("telegram");

			controller.handleOpen(browser);
			controller.handleOpen(tg);

			controller.handleMessage(tg, prompt("hi browser", "telegram"));
			await drain(controller, facade);

			const browserEvents = browser.events();
			expect(
				browserEvents.find((event) => event.type === "user_prompt"),
			).toEqual({
				type: "user_prompt",
				prompt: "hi browser",
				source: "telegram",
				images: undefined,
				replyContext: undefined,
			});
			expect(browserEvents.some((event) => event.type === "text")).toBeTrue();
		});

		test("broadcasts browser prompts and events to tui observers", async () => {
			const { controller, facade } = createController();
			const browser = mockWs("browser");
			const tui = mockWs("tui");

			controller.handleOpen(browser);
			controller.handleOpen(tui);

			controller.handleMessage(browser, prompt("hi from browser"));
			await drain(controller, facade);

			const tuiEvents = tui.events();
			expect(tuiEvents.find((event) => event.type === "user_prompt")).toEqual({
				type: "user_prompt",
				prompt: "hi from browser",
				source: "browser",
				images: undefined,
				replyContext: undefined,
			});
			expect(tuiEvents.some((event) => event.type === "text")).toBeTrue();
		});

		test("broadcasts interactive prompts and events to browser observers", async () => {
			const { controller, facade } = createController();
			const browser = mockWs("browser");
			const tui = mockWs("tui");

			controller.handleOpen(browser);
			controller.handleOpen(tui);

			controller.handleMessage(tui, prompt("hi from tui"));
			await drain(controller, facade);

			const browserEvents = browser.events();
			expect(
				browserEvents.find((event) => event.type === "user_prompt"),
			).toEqual({
				type: "user_prompt",
				prompt: "hi from tui",
				source: "tui",
				images: undefined,
				replyContext: undefined,
			});
			expect(browserEvents.some((event) => event.type === "text")).toBeTrue();
		});

		test("broadcasts image prompts to observers", async () => {
			const { controller, facade } = createController();
			const tui = mockWs();
			const tg = mockWs();

			controller.handleOpen(tui);
			controller.handleOpen(tg);

			const images: ImageRef[] = [
				{ path: "/tmp/cat.png", mediaType: "image/png" },
			];
			controller.handleMessage(tg, prompt("", "telegram", images));
			await drain(controller, facade);

			const userPrompt = tui
				.events()
				.find((event) => event.type === "user_prompt") as
				| { images?: DisplayImage[] }
				| undefined;
			expect(userPrompt?.images).toEqual([
				{
					kind: "managed",
					path: "/tmp/cat.png",
					mediaType: "image/png",
				},
			]);
		});

		test("broadcasts telegram reply context without mutating the prompt", async () => {
			const { controller, facade } = createController();
			const tui = mockWs();
			const tg = mockWs("telegram");

			controller.handleOpen(tui);
			controller.handleOpen(tg);

			controller.handleMessage(
				tg,
				prompt("what do you mean?", "telegram", undefined, 123, {
					text: 'the "cron" output',
				}),
			);
			await drain(controller, facade);

			expect(facade.allParams[0]).toMatchObject({
				prompt: "what do you mean?",
				replyContext: { text: 'the "cron" output' },
			});

			const userPrompt = tui
				.events()
				.find((event) => event.type === "user_prompt") as
				| {
						type: "user_prompt";
						prompt: string;
						source: string;
						images?: ImageRef[];
						replyContext?: { text: string };
				  }
				| undefined;
			expect(userPrompt).toEqual({
				type: "user_prompt",
				prompt: "what do you mean?",
				source: "telegram",
				replyContext: { text: 'the "cron" output' },
				images: undefined,
			});
		});

		test("broadcasts image events to observers", async () => {
			const facade = new MockFacade();
			const imagePath = createImagePath("observer-chart.png");
			facade.textChunks = [`Saved chart to ${imagePath}`];
			const { controller } = createController({ facade });
			const tui = mockWs();
			const tg = mockWs();

			controller.handleOpen(tui);
			controller.handleOpen(tg);

			controller.handleMessage(tg, prompt("plot", "telegram"));
			await drain(controller, facade);

			const imageEvent = tui.events().find((event) => event.type === "image");
			expect(imageEvent).toEqual({ type: "image", path: imagePath });
		});

		test("non-telegram source does not broadcast", async () => {
			const { controller, facade } = createController();
			const observer = mockWs();
			const sender = mockWs();

			controller.handleOpen(observer);
			controller.handleOpen(sender);

			controller.handleMessage(sender, prompt("local only"));
			await drain(controller, facade);

			// Observer should only see drain sentinel broadcast (if any), not the "local only" events
			const observerEvents = observer
				.events()
				.filter((e) => e.type !== "history_replay");
			// No user_prompt or text events
			expect(
				observerEvents.filter((e) => e.type === "user_prompt"),
			).toHaveLength(0);
		});
	});

	describe("error handling", () => {
		test("facade.run() throwing sends error event to sender", async () => {
			const facade = new MockFacade();
			const originalRun = facade.run.bind(facade);
			let callCount = 0;
			facade.run = async function* (params) {
				callCount++;
				if (callCount === 1) {
					throw new Error("SDK exploded");
				}
				yield* originalRun(params);
			};

			const { controller } = createController({ facade });
			const ws = mockWs();
			controller.handleOpen(ws);

			controller.handleMessage(ws, prompt("boom"));
			// Wait for error to propagate through queue
			await new Promise((r) => setTimeout(r, 50));

			const events = ws.events();
			const errorEvent = events.find((e) => e.type === "error");
			expect(errorEvent).toBeDefined();
			expect((errorEvent as { message: string }).message).toBe("SDK exploded");
		});

		test("facade.run() throwing for a tui prompt does not attempt heartbeat delivery", async () => {
			const delivered: Array<{
				images: Array<{ path: string; caption?: string }>;
				telegramChatId: number;
				text: string;
			}> = [];
			const facade = new MockFacade();
			facade.run = () => ({
				[Symbol.asyncIterator]() {
					return {
						async next() {
							throw new Error("SDK exploded");
						},
					};
				},
			});

			const { controller } = createController({
				deliverHeartbeatResult: (params) => {
					delivered.push(params);
				},
				facade,
			});
			const ws = mockWs("tui");
			controller.handleOpen(ws);

			controller.handleMessage(ws, prompt("boom"));
			await new Promise((resolve) => setTimeout(resolve, 50));

			expect(delivered).toEqual([]);
			expect(ws.events()).toContainEqual({
				type: "error",
				message: "SDK exploded",
			});
		});

		test("history replay failure is reported to the client without crashing", async () => {
			const historyReader = async (_id: string): Promise<never> => {
				throw new Error("history read failed");
			};
			const { controller, facade } = createController({ historyReader });
			const ws1 = mockWs();

			// Establish session
			controller.handleOpen(ws1);
			controller.handleMessage(ws1, prompt("setup"));
			await drain(controller, facade);

			// New client - history replay will fail but should not crash.
			const ws2 = mockWs();
			controller.handleOpen(ws2);
			await new Promise((r) => setTimeout(r, 20));

			const errors = ws2.events().filter((e) => e.type === "error");
			expect(errors).toEqual([
				{
					type: "error",
					message: "Failed to replay history: history read failed",
				},
			]);
		});
	});

	describe("sequencing", () => {
		test("concurrent prompts process in order", async () => {
			const facade = new MockFacade();
			facade.delayMs = 20;
			const { controller } = createController({ facade });
			const ws = mockWs();
			controller.handleOpen(ws);

			// Fire multiple prompts without waiting
			controller.handleMessage(ws, prompt("A"));
			controller.handleMessage(ws, prompt("B"));
			controller.handleMessage(ws, prompt("C"));

			// Wait for all to complete
			await new Promise((r) => setTimeout(r, 200));

			expect(facade.callOrder.slice(0, 3)).toEqual(["A", "B", "C"]);

			// Events should be sequential: text/done for A, then B, then C
			const events = ws.events();
			const significant = events.filter(
				(e) => e.type === "text" || e.type === "done",
			);
			const types = significant.map((e) => e.type);
			expect(types).toEqual(["text", "done", "text", "done", "text", "done"]);
		});

		test("concurrent telegram prompts keep direct replies bound to each sender", async () => {
			const facade = new MockFacade();
			facade.delayMs = 20;
			const { controller, state } = createController({ facade });
			const tg123 = mockWs("telegram");
			const tg456 = mockWs("telegram");
			controller.handleOpen(tg123);
			controller.handleOpen(tg456);

			controller.handleMessage(tg123, prompt("from 123", "telegram", [], 123));
			controller.handleMessage(tg456, prompt("from 456", "telegram", [], 456));

			await new Promise((r) => setTimeout(r, 200));

			expect(tg123.events().filter((event) => event.type === "text")).toEqual([
				{ type: "text", text: "echo: from 123" },
			]);
			expect(tg456.events().filter((event) => event.type === "text")).toEqual([
				{
					type: "text",
					text: "echo: from 456",
					sessionId: "mock-session-123",
				},
			]);
			expect(state.createHeartbeatDeliveryTarget()).toEqual({
				clientType: "telegram",
				telegramChatId: 456,
			});
		});
	});

	describe("heartbeat", () => {
		test("broadcastRuntimeStatus pushes updated heartbeat timer to clients", async () => {
			const { controller, facade } = createController();
			let nextHeartbeatAt: number | undefined = 1000;
			controller.setHeartbeatInfoProvider(() => ({
				nextHeartbeatAt,
				deferred: false,
			}));
			const ws = mockWs();

			controller.handleOpen(ws);
			controller.handleMessage(ws, prompt("setup"));
			await drain(controller, facade);

			nextHeartbeatAt = 2000;
			controller.broadcastRuntimeStatus();

			const statuses = ws
				.events()
				.filter((event) => event.type === "runtime_status") as Array<{
				nextHeartbeatAt?: number;
				sessionId?: string;
			}>;
			expect(statuses.at(-1)).toMatchObject({
				sessionId: "mock-session-123",
				nextHeartbeatAt: 2000,
			});
		});

		test("shows heartbeat prompt and live response to tui clients", async () => {
			const facade = new MockFacade();
			facade.delayMs = 40;
			const { controller } = createController({ facade });
			const setup = mockWs();
			controller.handleOpen(setup);
			controller.handleMessage(setup, prompt("setup"));
			await drain(controller, facade);

			const tui = mockWs("tui");
			const tg = mockWs("telegram");
			controller.handleOpen(tui);
			controller.handleOpen(tg);
			await new Promise((r) => setTimeout(r, 20));

			const scheduledAt = Date.now();
			expect(controller.enqueueHeartbeat("check tasks", scheduledAt, 0)).toBe(
				true,
			);
			await new Promise((r) => setTimeout(r, 10));

			const earlyTuiEvents = tui
				.events()
				.filter((event) => event.type !== "history_replay");
			expect(earlyTuiEvents).toContainEqual({
				type: "user_prompt",
				prompt: "check tasks",
				source: "heartbeat",
				sessionId: "mock-session-123",
			});

			await new Promise((r) => setTimeout(r, 80));

			const tuiEvents = tui
				.events()
				.filter((event) => event.type !== "history_replay");
			expect(tuiEvents).toContainEqual({
				type: "user_prompt",
				prompt: "check tasks",
				source: "heartbeat",
				sessionId: "mock-session-123",
			});
			expect(tuiEvents).toContainEqual({
				type: "text",
				text: "echo: check tasks",
				sessionId: "mock-session-123",
			});
			expect(tuiEvents.some((event) => event.type === "done")).toBe(true);

			const tgEvents = tg
				.events()
				.filter(
					(event) =>
						event.type !== "history_replay" && event.type !== "runtime_status",
				);
			expect(tgEvents).toHaveLength(0);
		});

		test("also delivers the final heartbeat result to the last telegram chat", async () => {
			const delivered: Array<{
				images: Array<{ path: string; caption?: string }>;
				telegramChatId: number;
				text: string;
			}> = [];
			const { controller } = createController({
				deliverHeartbeatResult: (params) => {
					delivered.push(params);
				},
			});
			const tui = mockWs("tui");
			const tg = mockWs("telegram");
			controller.handleOpen(tui);
			controller.handleOpen(tg);

			controller.handleMessage(
				tg,
				prompt("hello from tg", "telegram", [], 123),
			);
			await waitForDone(tg);
			const initialTuiDoneCount = tui
				.events()
				.filter((event) => event.type === "done").length;

			expect(controller.enqueueHeartbeat("check in", Date.now(), 0)).toBe(true);
			await waitForDoneCount(tui, initialTuiDoneCount + 1);

			expect(delivered).toEqual([
				{
					telegramChatId: 123,
					text: "echo: check in",
					images: [],
				},
			]);

			const tuiEvents = tui
				.events()
				.filter((event) => event.type !== "history_replay");
			expect(tuiEvents).toContainEqual({
				type: "user_prompt",
				prompt: "check in",
				source: "heartbeat",
				sessionId: "mock-session-123",
			});
			expect(tuiEvents).toContainEqual({
				type: "text",
				text: "echo: check in",
				sessionId: "mock-session-123",
			});

			const tgEvents = tg
				.events()
				.filter((event) => event.type !== "history_replay");
			expect(
				tgEvents.some(
					(event) => event.type === "text" && event.text === "echo: check in",
				),
			).toBe(false);
		});

		test("telegram forwarding failure does not emit a heartbeat error to tui", async () => {
			const originalConsoleError = console.error;
			const consoleErrorCalls: string[] = [];
			console.error = (message?: unknown) => {
				consoleErrorCalls.push(String(message));
			};

			try {
				const { controller } = createController({
					deliverHeartbeatResult: async () => {
						throw new Error("telegram send failed");
					},
				});
				const tui = mockWs("tui");
				const tg = mockWs("telegram");
				controller.handleOpen(tui);
				controller.handleOpen(tg);

				controller.handleMessage(
					tg,
					prompt("hello from tg", "telegram", [], 123),
				);
				await waitForDone(tg);
				const initialTuiDoneCount = tui
					.events()
					.filter((event) => event.type === "done").length;

				expect(
					controller.enqueueHeartbeat("check failure", Date.now(), 0),
				).toBe(true);
				await waitForDoneCount(tui, initialTuiDoneCount + 1);

				const tuiEvents = tui
					.events()
					.filter((event) => event.type !== "history_replay");
				expect(tuiEvents).toContainEqual({
					type: "user_prompt",
					prompt: "check failure",
					source: "heartbeat",
					sessionId: "mock-session-123",
				});
				expect(tuiEvents).toContainEqual({
					type: "text",
					text: "echo: check failure",
					sessionId: "mock-session-123",
				});
				expect(tuiEvents.some((event) => event.type === "done")).toBe(true);
				expect(tuiEvents.some((event) => event.type === "error")).toBe(false);
				expect(consoleErrorCalls).toEqual([
					"Failed to deliver heartbeat result to Telegram: telegram send failed",
				]);
			} finally {
				console.error = originalConsoleError;
			}
		});

		test("heartbeat delivery uses the latest user target at send time", async () => {
			const delivered: Array<{
				images: Array<{ path: string; caption?: string }>;
				telegramChatId: number;
				text: string;
			}> = [];
			const facade = new MockFacade();
			const { controller } = createController({
				deliverHeartbeatResult: (params) => {
					delivered.push(params);
				},
				facade,
			});
			const tui = mockWs("tui");
			const tg = mockWs("telegram");
			controller.handleOpen(tui);
			controller.handleOpen(tg);

			controller.handleMessage(
				tg,
				prompt("hello from tg", "telegram", [], 123),
			);
			await waitForDone(tg);

			facade.delayMs = 40;
			expect(controller.enqueueHeartbeat("check switch", Date.now(), 0)).toBe(
				true,
			);
			await new Promise((r) => setTimeout(r, 10));
			controller.handleMessage(tui, prompt("switch to tui", "tui"));
			await drain(controller, facade);

			expect(delivered).toEqual([]);
		});

		test("drops queued heartbeat when user activity happens after scheduling", async () => {
			const { controller, facade } = createController();
			const ws = mockWs();
			controller.handleOpen(ws);
			controller.handleMessage(ws, prompt("setup"));
			await drain(controller, facade);

			expect(controller.enqueueHeartbeat("stale heartbeat", 100, 0)).toBe(true);
			controller.handleMessage(ws, prompt("fresh user prompt"));
			await drain(controller, facade);

			expect(facade.callOrder).not.toContain("stale heartbeat");
			expect(facade.callOrder).toContain("fresh user prompt");
		});

		test("does not enqueue a second heartbeat while one is pending", async () => {
			const facade = new MockFacade();
			const { controller } = createController({ facade });
			const ws = mockWs();
			controller.handleOpen(ws);
			controller.handleMessage(ws, prompt("setup"));
			await drain(controller, facade);

			facade.delayMs = 40;
			const scheduledAt = Date.now();
			expect(
				controller.enqueueHeartbeat("first heartbeat", scheduledAt, 0),
			).toBe(true);
			expect(
				controller.enqueueHeartbeat("second heartbeat", scheduledAt + 1, 0),
			).toBe(false);
			await new Promise((r) => setTimeout(r, 120));

			expect(facade.callOrder).toContain("first heartbeat");
			expect(facade.callOrder).not.toContain("second heartbeat");
		});
	});

	describe("rollover", () => {
		test("delivers a new-session notice to the last telegram chat when rollover starts", async () => {
			const delivered: Array<{
				telegramChatId: number;
				text: string;
			}> = [];
			const { controller, facade } = createController({
				deliverRolloverNotice: (params) => {
					delivered.push(params);
				},
			});
			const tg = mockWs("telegram");
			controller.handleOpen(tg);
			controller.handleMessage(
				tg,
				prompt("hello from tg", "telegram", [], 123),
			);
			await waitForDone(tg);

			expect(controller.enqueueRollover("finalize old session", 480)).toBe(
				true,
			);
			await drain(controller, facade);

			expect(delivered).toEqual([
				{
					telegramChatId: 123,
					text: "Previous session auto-finalized after 8h idle. A new session will begin with your next message. Use /session to resume.",
				},
			]);
		});

		test("does not deliver rollover notices when the last target is tui", async () => {
			const delivered: Array<{
				telegramChatId: number;
				text: string;
			}> = [];
			const { controller, facade } = createController({
				deliverRolloverNotice: (params) => {
					delivered.push(params);
				},
			});
			const tui = mockWs("tui");
			controller.handleOpen(tui);
			controller.handleMessage(tui, prompt("hello from tui", "tui"));
			await waitForDone(tui);

			expect(controller.enqueueRollover("finalize old session", 480)).toBe(
				true,
			);
			await drain(controller, facade);

			expect(delivered).toEqual([]);
		});
	});

	describe("cron", () => {
		test("broadcasts cron results to tui clients and forwards them to the explicit cron telegram chat", async () => {
			const delivered: Array<{
				jobName: string;
				telegramChatId: number;
				text: string;
			}> = [];
			const { controller } = createController({
				deliverCronResult: (params) => {
					delivered.push(params);
				},
			});
			const tui = mockWs("tui");
			controller.handleOpen(tui);

			await controller.broadcastCronResult({
				jobName: "daily-summary",
				model: "haiku",
				sessionId: "cron-session-1",
				telegramChatId: 123,
				text: "All clear",
			});

			expect(
				tui.events().filter((event) => event.type === "cron_result"),
			).toEqual([
				expect.objectContaining({
					type: "cron_result",
					jobName: "daily-summary",
					providerId: PROVIDER_ID,
					text: "All clear",
					sessionId: "cron-session-1",
					ranAt: expect.any(Number),
				}),
			]);
			expect(delivered).toEqual([
				{
					jobName: "daily-summary",
					telegramChatId: 123,
					text: "All clear",
				},
			]);
		});

		test("does not forward cron results to telegram when no explicit cron chat is resolved", async () => {
			const delivered: Array<{
				jobName: string;
				telegramChatId: number;
				text: string;
			}> = [];
			const { controller } = createController({
				deliverCronResult: (params) => {
					delivered.push(params);
				},
			});
			const tui = mockWs("tui");
			controller.handleOpen(tui);

			await controller.broadcastCronResult({
				jobName: "daily-summary",
				model: "haiku",
				sessionId: "cron-session-1",
				text: "All clear",
			});

			expect(
				tui.events().filter((event) => event.type === "cron_result"),
			).toEqual([
				expect.objectContaining({
					type: "cron_result",
					jobName: "daily-summary",
					providerId: PROVIDER_ID,
					text: "All clear",
					sessionId: "cron-session-1",
					ranAt: expect.any(Number),
				}),
			]);
			expect(delivered).toEqual([]);
		});

		test("records cron runs as tagged sessions without replacing the active session", async () => {
			cleanupStore(TEST_DB);
			const store = new SessionStore(TEST_DB, { journalMode: "DELETE" });
			const { controller } = createController({ store });
			const ws = mockWs("tui");
			controller.handleOpen(ws);

			controller.handleMessage(ws, prompt("main prompt"));
			await waitForDone(ws);
			expect(store.getActiveSessionId(PROVIDER_ID)).toBe("mock-session-123");

			await controller.broadcastCronResult({
				jobName: "daily-summary",
				model: "haiku",
				sessionId: "cron-session-1",
				text: "All clear",
			});

			expect(store.get(PROVIDER_ID, "cron-session-1")).toMatchObject({
				providerId: PROVIDER_ID,
				sdkSessionId: "cron-session-1",
				title: "daily-summary",
				model: "haiku",
				tag: "cron",
			});
			expect(store.getActiveSessionId(PROVIDER_ID)).toBe("mock-session-123");
			expect(store.listCronRunsByTitle("daily-summary", { limit: 1 })).toEqual([
				expect.objectContaining({
					providerId: PROVIDER_ID,
					sessionId: "cron-session-1",
					resultText: "",
				}),
			]);

			store.close();
			cleanupStore(TEST_DB);
		});

		test("records suppressed cron runs without broadcasting or telegram delivery", async () => {
			cleanupStore(TEST_DB);
			const store = new SessionStore(TEST_DB, { journalMode: "DELETE" });
			const delivered: Array<{
				jobName: string;
				telegramChatId: number;
				text: string;
			}> = [];
			const { controller } = createController({
				deliverCronResult: (params) => {
					delivered.push(params);
				},
				store,
			});
			const tui = mockWs("tui");
			controller.handleOpen(tui);

			await controller.broadcastCronResult({
				jobName: "bayern-match-check",
				model: "haiku",
				sessionId: "cron-session-silent",
				suppressDelivery: true,
				telegramChatId: 123,
				text: "",
			});

			expect(
				tui.events().filter((event) => event.type === "cron_result"),
			).toEqual([]);
			expect(delivered).toEqual([]);
			expect(store.get(PROVIDER_ID, "cron-session-silent")).toMatchObject({
				providerId: PROVIDER_ID,
				sdkSessionId: "cron-session-silent",
				title: "bayern-match-check",
				model: "haiku",
				tag: "cron",
			});

			store.close();
			cleanupStore(TEST_DB);
		});
	});

	describe("session mutation during active run", () => {
		test("switching back to a running session replays the buffered partial stream", async () => {
			cleanupStore(TEST_DB);
			const store = new SessionStore(TEST_DB, { journalMode: "DELETE" });
			store.upsert({
				providerId: PROVIDER_ID,
				sdkSessionId: "sdk-alpha",
				title: "Alpha",
				model: "opus",
				source: "tui",
			});
			store.upsert({
				providerId: PROVIDER_ID,
				sdkSessionId: "sdk-beta",
				title: "Beta",
				model: "opus",
				source: "tui",
			});
			store.setActiveSessionId(PROVIDER_ID, "sdk-alpha");
			const facade = new SessionAwareStreamingFacade();
			const { controller } = createController({
				facade,
				historyReader: async (sessionId) => [
					{
						kind: "chat",
						role: "user",
						content:
							sessionId === "sdk-alpha" ? "continue alpha" : "continue beta",
					},
				],
				store,
			});
			const ws = mockWs();
			controller.handleOpen(ws);

			controller.handleMessage(ws, prompt("continue alpha"));
			await facade.waitForFirstChunk("sdk-alpha");

			controller.handleMessage(ws, command("/session sdk-beta"));
			await new Promise((r) => setTimeout(r, 20));

			const eventCountBeforeReturn = ws.events().length;
			controller.handleMessage(ws, command("/session sdk-alpha"));
			await new Promise((r) => setTimeout(r, 20));

			const replayEvents = ws.events().slice(eventCountBeforeReturn);
			expect(replayEvents).toContainEqual({
				type: "streaming_sync",
				sdkSessionId: "sdk-alpha",
				text: "partial sdk-alpha",
				thinking: "",
				images: [],
			});

			facade.release("sdk-alpha");
			await waitForDone(ws);
			expect(ws.events()).toContainEqual({
				type: "text",
				text: " later sdk-alpha",
				sessionId: "sdk-alpha",
			});

			store.close();
			cleanupStore(TEST_DB);
		});

		test("/session switch keeps the prior session running in background without surfacing it", async () => {
			cleanupStore(TEST_DB);
			const store = new SessionStore(TEST_DB, { journalMode: "DELETE" });
			store.upsert({
				providerId: PROVIDER_ID,
				sdkSessionId: "sdk-alpha",
				title: "Alpha",
				model: "opus",
				source: "tui",
			});
			store.upsert({
				providerId: PROVIDER_ID,
				sdkSessionId: "sdk-beta",
				title: "Beta",
				model: "opus",
				source: "tui",
			});
			store.setActiveSessionId(PROVIDER_ID, "sdk-alpha");
			const facade = new SessionAwareBlockingFacade();
			const { controller } = createController({ facade, store });
			const ws = mockWs();
			controller.handleOpen(ws);

			controller.handleMessage(ws, prompt("continue alpha"));
			await facade.waitStarted("sdk-alpha");

			const eventCountBeforeSwitch = ws.events().length;
			controller.handleMessage(ws, command("/session sdk-beta"));
			await new Promise((r) => setTimeout(r, 20));

			expect(facade.allParams[0]?.resume).toBe("sdk-alpha");
			expect(facade.allParams[0]?.abortController?.signal.aborted).toBe(false);
			expect(store.getActiveSessionId(PROVIDER_ID)).toBe("sdk-beta");

			const switchedStatus = ws
				.events()
				.filter((event) => event.type === "runtime_status")
				.at(-1) as { running?: boolean; sessionId?: string } | undefined;
			expect(switchedStatus).toMatchObject({
				running: false,
				sessionId: "sdk-beta",
			});

			facade.release("sdk-alpha");
			await new Promise((r) => setTimeout(r, 20));

			const postSwitchEvents = ws.events().slice(eventCountBeforeSwitch);
			expect(
				postSwitchEvents.some(
					(event) => event.type === "text" || event.type === "done",
				),
			).toBe(false);
			expect(store.getUsage(PROVIDER_ID, "sdk-alpha")).toEqual(
				facade.doneUsage,
			);

			store.close();
			cleanupStore(TEST_DB);
		});

		test("different sessions can run in parallel within one agent", async () => {
			cleanupStore(TEST_DB);
			const store = new SessionStore(TEST_DB, { journalMode: "DELETE" });
			store.upsert({
				providerId: PROVIDER_ID,
				sdkSessionId: "sdk-alpha",
				title: "Alpha",
				model: "opus",
				source: "tui",
			});
			store.upsert({
				providerId: PROVIDER_ID,
				sdkSessionId: "sdk-beta",
				title: "Beta",
				model: "opus",
				source: "tui",
			});
			store.setActiveSessionId(PROVIDER_ID, "sdk-alpha");
			const facade = new SessionAwareBlockingFacade();
			const { controller } = createController({ facade, store });
			const ws = mockWs();
			controller.handleOpen(ws);

			controller.handleMessage(ws, prompt("run alpha"));
			await facade.waitStarted("sdk-alpha");

			controller.handleMessage(ws, command("/session sdk-beta"));
			await new Promise((r) => setTimeout(r, 20));
			controller.handleMessage(ws, prompt("run beta"));
			await facade.waitStarted("sdk-beta");

			expect(facade.allParams.map((params) => params.resume)).toEqual([
				"sdk-alpha",
				"sdk-beta",
			]);

			facade.release("sdk-beta");
			await waitForDone(ws);
			facade.release("sdk-alpha");
			await new Promise((r) => setTimeout(r, 20));

			store.close();
			cleanupStore(TEST_DB);
		});

		test("/new during active run does not let stale completeRun overwrite session", async () => {
			const facade = new MockFacade();
			facade.delayMs = 100;
			const { controller } = createController({ facade });
			const ws = mockWs();
			controller.handleOpen(ws);

			// Start a slow prompt — establishes a session
			controller.handleMessage(ws, prompt("setup"));
			await new Promise((r) => setTimeout(r, 30));

			// /new while run is active — should abort and clear session
			controller.handleMessage(ws, command("/new"));
			await new Promise((r) => setTimeout(r, 150));

			// Session should be cleared, not restored by stale completeRun
			controller.handleMessage(ws, command("/status"));
			await new Promise((r) => setTimeout(r, 10));

			const events = ws.events();
			const status = events.findLast((e) => e.type === "runtime_status") as
				| { sessionId?: string }
				| undefined;
			expect(status).toBeDefined();
			expect(status?.sessionId).toBeUndefined();
		});

		test("/new aborts the active run", async () => {
			const facade = new MockFacade();
			facade.delayMs = 200;
			const { controller } = createController({ facade });
			const ws = mockWs();
			controller.handleOpen(ws);

			controller.handleMessage(ws, prompt("slow"));
			await new Promise((r) => setTimeout(r, 30));

			controller.handleMessage(ws, command("/new"));
			await new Promise((r) => setTimeout(r, 50));

			const slowCall = facade.allParams.find((p) => p.prompt === "slow");
			expect(slowCall?.abortController?.signal.aborted).toBe(true);
		});
	});

	describe("restart", () => {
		test("/restart sends status message and calls restart handler", async () => {
			let restartCalled = false;
			const facade = new MockFacade();
			const state = new RuntimeState(facade.providerId);
			const sessions = new SessionService(state);
			const controller = createRuntimeController({
				facade,
				restart: () => {
					restartCalled = true;
				},
				sessions,
				state,
			});
			const ws = mockWs();
			controller.handleOpen(ws);

			controller.handleMessage(ws, command("/restart"));
			await new Promise((r) => setTimeout(r, 10));

			expect(ws.events()).toContainEqual({
				type: "status",
				message: "Restarting daemon...",
			});
			expect(restartCalled).toBe(true);
		});

		test("/restart aborts active run before restarting", async () => {
			let restartCalled = false;
			const facade = new MockFacade();
			facade.delayMs = 200;
			const state = new RuntimeState(facade.providerId);
			const sessions = new SessionService(state);
			const controller = createRuntimeController({
				facade,
				restart: () => {
					restartCalled = true;
				},
				sessions,
				state,
			});
			const ws = mockWs();
			controller.handleOpen(ws);

			controller.handleMessage(ws, prompt("slow task"));
			await new Promise((r) => setTimeout(r, 30));

			controller.handleMessage(ws, command("/restart"));
			await new Promise((r) => setTimeout(r, 50));

			const slowCall = facade.allParams.find((p) => p.prompt === "slow task");
			expect(slowCall?.abortController?.signal.aborted).toBe(true);
			expect(restartCalled).toBe(true);
		});

		test("/restart without handler sends error", async () => {
			const { controller } = createController();
			const ws = mockWs();
			controller.handleOpen(ws);

			controller.handleMessage(ws, command("/restart"));
			await new Promise((r) => setTimeout(r, 10));

			expect(ws.events()).toContainEqual({
				type: "error",
				message: "Restart handler not configured",
			});
		});

		test("/restart broadcasts error when handler throws", async () => {
			const facade = new MockFacade();
			const state = new RuntimeState(facade.providerId);
			const sessions = new SessionService(state);
			const controller = createRuntimeController({
				facade,
				restart: () => {
					throw new Error("spawn failed");
				},
				sessions,
				state,
			});
			const ws = mockWs();
			controller.handleOpen(ws);

			controller.handleMessage(ws, command("/restart"));
			await new Promise((r) => setTimeout(r, 10));

			expect(ws.events()).toContainEqual({
				type: "status",
				message: "Restarting daemon...",
			});
			expect(ws.events()).toContainEqual({
				type: "error",
				message: "Restart failed: spawn failed",
			});
		});
	});

	describe("abort", () => {
		test("beginShutdown aborts the active run and drops queued prompts", async () => {
			const facade = new MockFacade();
			facade.delayMs = 200;
			const { controller } = createController({ facade });
			const ws = mockWs();
			controller.handleOpen(ws);

			controller.handleMessage(ws, prompt("first"));
			controller.handleMessage(ws, prompt("second"));
			await new Promise((r) => setTimeout(r, 30));

			controller.beginShutdown();
			await controller.drain();

			const firstCall = facade.allParams.find((p) => p.prompt === "first");
			expect(firstCall?.abortController?.signal.aborted).toBe(true);
			expect(facade.callOrder).toEqual(["first"]);
		});

		test("beginShutdown aborts and drains pending auto-title attempts", async () => {
			cleanupStore(TEST_DB);
			const store = new SessionStore(TEST_DB, { journalMode: "DELETE" });
			const facade = new ShutdownAutoTitleFacade();
			const { controller } = createController({
				autoTitle: { model: "haiku" },
				facade,
				store,
			});
			const ws = mockWs();
			controller.handleOpen(ws);

			try {
				controller.handleMessage(ws, prompt("Summarize shutdown behavior"));
				await waitForDone(ws);
				await waitForCondition(() => facade.titleCalls.length === 1);

				controller.beginShutdown();
				await controller.drain();

				const titleCall = facade.titleCalls[0];
				expect(titleCall?.abortController?.signal.aborted).toBe(true);
				expect(facade.titleAbortObserved).toBe(true);
				expect(store.get(PROVIDER_ID, "sdk-auto-main")).toMatchObject({
					title: "New conversation",
					autoTitleAttempted: false,
				});
			} finally {
				facade.releaseTitle();
				await facade.waitForTitleSettled();
				if (!facade.titleAbortObserved) {
					await waitForCondition(
						() =>
							store.get(PROVIDER_ID, "sdk-auto-main")?.autoTitleAttempted ===
							true,
					).catch(() => {});
				}
				store.close();
				cleanupStore(TEST_DB);
			}
		});

		test("/stop aborts a running prompt", async () => {
			const facade = new MockFacade();
			facade.delayMs = 200;
			const { controller } = createController({ facade });
			const ws = mockWs();
			const stopRequester = mockWs();
			controller.handleOpen(ws);
			controller.handleOpen(stopRequester);

			// Start a slow prompt
			controller.handleMessage(ws, prompt("slow task"));
			// Let it start processing
			await new Promise((r) => setTimeout(r, 30));

			// Send /stop
			controller.handleMessage(stopRequester, command("/stop"));
			await new Promise((r) => setTimeout(r, 50));

			// The facade's abort signal should have been triggered
			const slowCall = facade.allParams.find((p) => p.prompt === "slow task");
			expect(slowCall?.abortController?.signal.aborted).toBe(true);
			expect(stopRequester.events()).toContainEqual({
				type: "status",
				message: "Request interrupted by user",
				presentation: "inline",
			});
		});

		test("/stop suppresses provider abort errors", async () => {
			const facade = new AbortErrorFacade();
			const { controller } = createController({ facade });
			const ws = mockWs();
			const stopRequester = mockWs();
			controller.handleOpen(ws);
			controller.handleOpen(stopRequester);

			controller.handleMessage(ws, prompt("slow task"));
			await facade.started.promise;

			controller.handleMessage(stopRequester, command("/stop"));
			await new Promise((r) => setTimeout(r, 20));

			const userFacingEvents = [...ws.events(), ...stopRequester.events()];
			expect(userFacingEvents).not.toContainEqual({
				type: "error",
				message: "AbortError: operation aborted",
			});
		});

		test("interrupted fresh sessions remain replayable after restart", async () => {
			cleanupStore(TEST_DB);
			const store = new SessionStore(TEST_DB, { journalMode: "DELETE" });
			const facade = new AbortErrorFacade();
			const { controller } = createController({ facade, store });
			const ws = mockWs();
			const stopRequester = mockWs();
			controller.handleOpen(ws);
			controller.handleOpen(stopRequester);

			controller.handleMessage(ws, prompt("slow task"));
			await facade.started.promise;

			const sessionId = facade.lastParams?.sessionId;
			if (!sessionId) {
				throw new Error("Expected interrupted run to have a session id");
			}

			controller.handleMessage(stopRequester, command("/stop"));
			await new Promise((r) => setTimeout(r, 20));

			expect(store.get(PROVIDER_ID, sessionId)?.title).toBe("slow task");
			expect(store.getActiveSessionId(PROVIDER_ID)).toBe(sessionId);

			const restored = createController({
				store,
				historyReader: async (id) => {
					expect(id).toBe(sessionId);
					return [
						{
							kind: "system",
							event: "status",
							text: "Request interrupted by user",
						},
					];
				},
			});
			const restoredClient = mockWs();
			restored.controller.handleOpen(restoredClient);
			await new Promise((r) => setTimeout(r, 20));

			expect(restoredClient.events()).toContainEqual({
				type: "history_replay",
				sdkSessionId: sessionId,
				messages: [
					{
						kind: "system",
						event: "status",
						text: "Request interrupted by user",
					},
				],
			});

			store.close();
			cleanupStore(TEST_DB);
		});

		test("/stop when nothing is running sends info message", async () => {
			const { controller } = createController();
			const ws = mockWs();
			controller.handleOpen(ws);

			controller.handleMessage(ws, command("/stop"));
			await new Promise((r) => setTimeout(r, 10));

			const events = ws.events();
			expect(events).toContainEqual({
				type: "status",
				message: "Nothing to stop",
				presentation: "inline",
			});
		});

		test("abort controller is passed to facade.run()", async () => {
			const { controller, facade } = createController();
			const ws = mockWs();
			controller.handleOpen(ws);

			controller.handleMessage(ws, prompt("test"));
			await drain(controller, facade);

			const testCall = facade.allParams.find((p) => p.prompt === "test");
			expect(testCall?.abortController).toBeDefined();
			expect(testCall?.abortController).toBeInstanceOf(AbortController);
		});
	});
});
