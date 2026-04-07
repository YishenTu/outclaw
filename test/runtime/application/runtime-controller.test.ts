import { describe, expect, test } from "bun:test";
import type { ServerEvent } from "../../../src/common/protocol.ts";
import { RuntimeController } from "../../../src/runtime/application/runtime-controller.ts";
import type { SessionStore } from "../../../src/runtime/persistence/session-store.ts";
import type { WsClient } from "../../../src/runtime/transport/client-hub.ts";
import { MockFacade } from "../../helpers/mock-facade.ts";

// Minimal WsClient stub — ClientHub only calls .send()
function mockWs(): WsClient & { events: () => ServerEvent[] } {
	const sent: string[] = [];
	const ws = {
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
			store: overrides.store,
			historyReader: overrides.historyReader,
		}),
	};
}

function prompt(text: string, source?: string) {
	return JSON.stringify({ type: "prompt", prompt: text, source });
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
