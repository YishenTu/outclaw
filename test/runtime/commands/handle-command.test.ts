import { describe, expect, test } from "bun:test";
import type { ServerEvent } from "../../../src/common/protocol.ts";
import { RuntimeState } from "../../../src/runtime/application/runtime-state.ts";
import { handleRuntimeCommand } from "../../../src/runtime/commands/handle-command.ts";
import {
	ClientHub,
	type WsClient,
} from "../../../src/runtime/transport/client-hub.ts";

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

function setup() {
	const hub = new ClientHub();
	const ws = mockWs();
	const state = new RuntimeState();
	hub.add(ws);

	async function run(command: string) {
		await handleRuntimeCommand({
			command,
			hub,
			replayHistoryToAll: async () => {},
			state,
			ws,
		});
	}

	return { hub, ws, state, run };
}

describe("handleRuntimeCommand", () => {
	describe("/status", () => {
		test("sends runtime_status event", async () => {
			const { ws, run } = setup();
			await run("/status");
			const events = ws.events();
			expect(events).toHaveLength(1);
			expect(events[0]?.type).toBe("runtime_status");
		});
	});

	describe("/new", () => {
		test("clears session and broadcasts session_cleared", async () => {
			const { ws, state, run } = setup();
			state.preparePrompt("hello");
			await run("/new");
			expect(state.sessionId).toBeUndefined();

			const cleared = ws.events().find((e) => e.type === "session_cleared");
			expect(cleared).toBeDefined();
		});
	});

	describe("/model", () => {
		test("reports current model when no argument", async () => {
			const { ws, run } = setup();
			await run("/model");
			const event = ws.events().find((e) => e.type === "model_changed");
			expect(event).toBeDefined();
		});

		test("changes model with valid alias", async () => {
			const { ws, state, run } = setup();
			await run("/model haiku");
			expect(state.model).toBe("haiku");

			const event = ws.events().find((e) => e.type === "model_changed");
			expect((event as { model: string }).model).toBe("haiku");
		});

		test("sends error for invalid model", async () => {
			const { ws, run } = setup();
			await run("/model gpt-4");
			const event = ws.events().find((e) => e.type === "error");
			expect(event).toBeDefined();
			expect((event as { message: string }).message).toContain("Invalid model");
		});

		test("accepts model alias as shortcut command", async () => {
			const { state, run } = setup();
			await run("/sonnet");
			expect(state.model).toBe("sonnet");
		});
	});

	describe("/thinking", () => {
		test("reports current effort when no argument", async () => {
			const { ws, run } = setup();
			await run("/thinking");
			const event = ws.events().find((e) => e.type === "effort_changed");
			expect(event).toBeDefined();
		});

		test("changes effort with valid level", async () => {
			const { ws, state, run } = setup();
			await run("/thinking max");
			expect(state.effort).toBe("max");

			const event = ws.events().find((e) => e.type === "effort_changed");
			expect((event as { effort: string }).effort).toBe("max");
		});

		test("sends error for invalid effort", async () => {
			const { ws, run } = setup();
			await run("/thinking extreme");
			const event = ws.events().find((e) => e.type === "error");
			expect(event).toBeDefined();
			expect((event as { message: string }).message).toContain(
				"Invalid effort",
			);
		});
	});

	describe("/session", () => {
		test("sends error when no active session", async () => {
			const { ws, run } = setup();
			await run("/session");
			const event = ws.events().find((e) => e.type === "error");
			expect(event).toBeDefined();
			expect((event as { message: string }).message).toContain(
				"No active session",
			);
		});

		test("shows session info when session is active", async () => {
			const { ws, state, run } = setup();
			state.preparePrompt("test chat");
			state.completeRun({
				type: "done",
				sessionId: "sdk-123",
				durationMs: 10,
			});

			await run("/session");
			const event = ws.events().find((e) => e.type === "session_info");
			expect(event).toBeDefined();
			expect((event as { sdkSessionId: string }).sdkSessionId).toBe("sdk-123");
		});

		test("/session list sends session_list event (no store)", async () => {
			const { ws, run } = setup();
			await run("/session list");
			const event = ws.events().find((e) => e.type === "session_list");
			expect(event).toBeDefined();
			expect((event as { sessions: unknown[] }).sessions).toEqual([]);
		});

		test("/session with unknown prefix sends error", async () => {
			const { ws, run } = setup();
			await run("/session nonexistent-id");
			const event = ws.events().find((e) => e.type === "error");
			expect(event).toBeDefined();
			expect((event as { message: string }).message).toContain(
				"No session matching",
			);
		});
	});

	describe("broadcasting", () => {
		test("/model broadcasts to all connected clients", async () => {
			const hub = new ClientHub();
			const sender = mockWs();
			const observer = mockWs();
			const state = new RuntimeState();
			hub.add(sender);
			hub.add(observer);

			await handleRuntimeCommand({
				command: "/model sonnet",
				hub,
				replayHistoryToAll: async () => {},
				state,
				ws: sender,
			});

			const observerEvent = observer
				.events()
				.find((e) => e.type === "model_changed");
			expect(observerEvent).toBeDefined();
		});
	});
});
