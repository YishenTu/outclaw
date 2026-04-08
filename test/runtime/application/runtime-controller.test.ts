import { describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { ImageRef, ServerEvent } from "../../../src/common/protocol.ts";
import { RuntimeController } from "../../../src/runtime/application/runtime-controller.ts";
import { SessionStore } from "../../../src/runtime/persistence/session-store.ts";
import type { WsClient } from "../../../src/runtime/transport/client-hub.ts";
import { MockFacade } from "../../helpers/mock-facade.ts";

const TEST_DB = join(import.meta.dir, ".tmp-runtime-controller.sqlite");

// Minimal WsClient stub — ClientHub only calls .send()
function mockWs(
	clientType: "telegram" | "tui" = "tui",
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

function createController(
	overrides: {
		facade?: MockFacade;
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
		promptHomeDir?: string;
		store?: SessionStore;
		historyReader?: (
			id: string,
		) => Promise<Array<{ role: "user" | "assistant"; content: string }>>;
	} = {},
) {
	const facade = overrides.facade ?? new MockFacade();
	return {
		facade,
		controller: new RuntimeController({
			facade,
			cwd: overrides.cwd,
			promptHomeDir: overrides.promptHomeDir,
			store: overrides.store,
			historyReader: overrides.historyReader,
			deliverCronResult: overrides.deliverCronResult,
			deliverHeartbeatResult: overrides.deliverHeartbeatResult,
		}),
	};
}

function prompt(
	text: string,
	source?: string,
	images?: ImageRef[],
	telegramChatId?: number,
) {
	return JSON.stringify({
		type: "prompt",
		prompt: text,
		source,
		images,
		telegramChatId,
	});
}

function command(cmd: string) {
	return JSON.stringify({ type: "command", command: cmd });
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
	return new Promise<void>((resolve) => {
		const check = setInterval(() => {
			if (ws.events().some((event) => event.type === "done")) {
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

describe("RuntimeController", () => {
	describe("client lifecycle", () => {
		test("handleOpen replays history when session is active", async () => {
			const historyReader = async (_id: string) => [
				{ role: "user" as const, content: "past question" },
				{ role: "assistant" as const, content: "past answer" },
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
			expect((replay as { messages: unknown[] }).messages).toHaveLength(2);
		});

		test("handleOpen does not replay when no active session", async () => {
			const historyReader = async (_id: string) => [
				{ role: "user" as const, content: "should not appear" },
			];
			const { controller } = createController({ historyReader });
			const ws = mockWs();

			controller.handleOpen(ws);
			await new Promise((r) => setTimeout(r, 20));

			expect(ws.events()).toHaveLength(0);
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

			// ws2 should have no events after being removed
			expect(ws2.events()).toHaveLength(0);
		});
	});

	describe("message routing", () => {
		test("invalid JSON sends error to sender", () => {
			const { controller } = createController();
			const ws = mockWs();
			controller.handleOpen(ws);

			controller.handleMessage(ws, "not json{{{");

			const events = ws.events();
			expect(events).toHaveLength(1);
			expect(events[0]?.type).toBe("error");
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
			facade.imageEvents = [{ path: "/tmp/chart.png" }];
			const { controller } = createController({ facade });
			const ws = mockWs();
			controller.handleOpen(ws);

			controller.handleMessage(ws, prompt("plot"));
			await drain(controller, facade);

			const imageEvents = ws.events().filter((event) => event.type === "image");
			expect(imageEvents).toEqual([{ type: "image", path: "/tmp/chart.png" }]);
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
			const { controller, facade } = createController();
			const ws = mockWs();
			controller.handleOpen(ws);

			controller.handleMessage(ws, prompt("What is the meaning of life?"));
			await drain(controller, facade);

			// Check via /session command
			controller.handleMessage(ws, command("/session"));
			await new Promise((r) => setTimeout(r, 10));

			const events = ws.events();
			const info = events.find((e) => e.type === "session_info") as
				| { title: string }
				| undefined;
			expect(info).toBeDefined();
			expect(info?.title).toBe("What is the meaning of life?");
		});

		test("sets session title for an image-only prompt", async () => {
			const { controller, facade } = createController();
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

			const info = ws.events().find((e) => e.type === "session_info") as
				| { title: string }
				| undefined;
			expect(info?.title).toBe("Image");
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
				| { images?: ImageRef[] }
				| undefined;
			expect(userPrompt?.images).toEqual(images);
		});

		test("broadcasts image events to observers", async () => {
			const facade = new MockFacade();
			facade.imageEvents = [{ path: "/tmp/chart.png" }];
			const { controller } = createController({ facade });
			const tui = mockWs();
			const tg = mockWs();

			controller.handleOpen(tui);
			controller.handleOpen(tg);

			controller.handleMessage(tg, prompt("plot", "telegram"));
			await drain(controller, facade);

			const imageEvent = tui.events().find((event) => event.type === "image");
			expect(imageEvent).toEqual({ type: "image", path: "/tmp/chart.png" });
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

		test("history replay failure is silently swallowed", async () => {
			const historyReader = async (_id: string): Promise<never> => {
				throw new Error("history read failed");
			};
			const { controller, facade } = createController({ historyReader });
			const ws1 = mockWs();

			// Establish session
			controller.handleOpen(ws1);
			controller.handleMessage(ws1, prompt("setup"));
			await drain(controller, facade);

			// New client — history replay will fail but should not crash
			const ws2 = mockWs();
			controller.handleOpen(ws2);
			await new Promise((r) => setTimeout(r, 20));

			// No error event sent (failure is swallowed)
			const errors = ws2.events().filter((e) => e.type === "error");
			expect(errors).toHaveLength(0);
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
	});

	describe("heartbeat", () => {
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
			});

			await new Promise((r) => setTimeout(r, 80));

			const tuiEvents = tui
				.events()
				.filter((event) => event.type !== "history_replay");
			expect(tuiEvents).toContainEqual({
				type: "user_prompt",
				prompt: "check tasks",
				source: "heartbeat",
			});
			expect(tuiEvents).toContainEqual({
				type: "text",
				text: "echo: check tasks",
			});
			expect(tuiEvents.some((event) => event.type === "done")).toBe(true);

			const tgEvents = tg
				.events()
				.filter((event) => event.type !== "history_replay");
			expect(tgEvents).toHaveLength(0);
		});

		test("also delivers the final heartbeat result to the last telegram chat", async () => {
			const delivered: Array<{
				images: Array<{ path: string; caption?: string }>;
				telegramChatId: number;
				text: string;
			}> = [];
			const { controller, facade } = createController({
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

			expect(controller.enqueueHeartbeat("check in", Date.now(), 0)).toBe(true);
			await drain(controller, facade);

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
			});
			expect(tuiEvents).toContainEqual({
				type: "text",
				text: "echo: check in",
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
				const { controller, facade } = createController({
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

				expect(
					controller.enqueueHeartbeat("check failure", Date.now(), 0),
				).toBe(true);
				await drain(controller, facade);

				const tuiEvents = tui
					.events()
					.filter((event) => event.type !== "history_replay");
				expect(tuiEvents).toContainEqual({
					type: "user_prompt",
					prompt: "check failure",
					source: "heartbeat",
				});
				expect(tuiEvents).toContainEqual({
					type: "text",
					text: "echo: check failure",
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

	describe("cron", () => {
		test("broadcasts cron results to tui clients and forwards them to the last telegram chat", async () => {
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
			const tg = mockWs("telegram");
			controller.handleOpen(tui);
			controller.handleOpen(tg);

			controller.handleMessage(
				tg,
				prompt("hello from telegram", "telegram", [], 123),
			);
			await waitForDone(tg);

			await controller.broadcastCronResult({
				jobName: "daily-summary",
				model: "haiku",
				sessionId: "cron-session-1",
				text: "All clear",
			});

			expect(
				tui.events().filter((event) => event.type === "cron_result"),
			).toEqual([
				{
					type: "cron_result",
					jobName: "daily-summary",
					text: "All clear",
				},
			]);
			expect(delivered).toEqual([
				{
					jobName: "daily-summary",
					telegramChatId: 123,
					text: "All clear",
				},
			]);
		});

		test("records cron runs as tagged sessions without replacing the active session", async () => {
			cleanupStore(TEST_DB);
			const store = new SessionStore(TEST_DB, { journalMode: "DELETE" });
			const { controller } = createController({ store });
			const ws = mockWs("tui");
			controller.handleOpen(ws);

			controller.handleMessage(ws, prompt("main prompt"));
			await waitForDone(ws);
			expect(store.getActiveSessionId()).toBe("mock-session-123");

			await controller.broadcastCronResult({
				jobName: "daily-summary",
				model: "haiku",
				sessionId: "cron-session-1",
				text: "All clear",
			});

			expect(store.get("cron-session-1")).toMatchObject({
				sdkSessionId: "cron-session-1",
				title: "daily-summary",
				model: "haiku",
				tag: "cron",
			});
			expect(store.getActiveSessionId()).toBe("mock-session-123");

			store.close();
			cleanupStore(TEST_DB);
		});
	});

	describe("session mutation during active run", () => {
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

	describe("abort", () => {
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
				message: "Stopping current run",
			});
		});

		test("/stop when nothing is running sends info message", async () => {
			const { controller } = createController();
			const ws = mockWs();
			controller.handleOpen(ws);

			controller.handleMessage(ws, command("/stop"));
			await new Promise((r) => setTimeout(r, 10));

			const events = ws.events();
			expect(events.some((e) => e.type === "status")).toBe(true);
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
