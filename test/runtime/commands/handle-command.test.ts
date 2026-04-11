import { describe, expect, test } from "bun:test";
import type { ServerEvent } from "../../../src/common/protocol.ts";
import { RuntimeState } from "../../../src/runtime/application/runtime-state.ts";
import { handleRuntimeCommand } from "../../../src/runtime/commands/handle-command.ts";
import {
	ClientHub,
	type WsClient,
} from "../../../src/runtime/transport/client-hub.ts";

const PROVIDER_ID = "mock";

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
	const state = new RuntimeState(PROVIDER_ID);
	hub.add(ws);

	async function run(command: string) {
		await handleRuntimeCommand({
			command,
			createStatusEvent: () => state.createStatusEvent(),
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
		test("sends runtime_status event with requested flag", async () => {
			const { ws, run } = setup();
			await run("/status");
			const events = ws.events();
			expect(events).toHaveLength(1);
			expect(events[0]?.type).toBe("runtime_status");
			expect((events[0] as { requested?: boolean }).requested).toBe(true);
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
		test("sends session_menu with empty list when no store", async () => {
			const { ws, run } = setup();
			await run("/session");
			const event = ws.events().find((e) => e.type === "session_menu");
			expect(event).toBeDefined();
			expect((event as { sessions: unknown[] }).sessions).toEqual([]);
			expect(
				(event as { activeSessionId?: string }).activeSessionId,
			).toBeUndefined();
		});

		test("sends session_menu with active session id", async () => {
			const { ws, state, run } = setup();
			state.preparePrompt("test chat");
			state.completeRun({
				type: "done",
				sessionId: "sdk-123",
				durationMs: 10,
			});

			await run("/session");
			const event = ws.events().find((e) => e.type === "session_menu");
			expect(event).toBeDefined();
			expect((event as { activeSessionId?: string }).activeSessionId).toBe(
				"sdk-123",
			);
		});

		test("/session list sends session_list event (no store)", async () => {
			const { ws, run } = setup();
			await run("/session list");
			const event = ws.events().find((e) => e.type === "session_list");
			expect(event).toBeDefined();
			expect((event as { sessions: unknown[] }).sessions).toEqual([]);
		});

		test("/session delete sends session_deleted", async () => {
			const { ws, run } = setup();
			await run("/session delete sdk-123");
			const event = ws.events().find((e) => e.type === "session_deleted");
			expect(event).toBeDefined();
			expect((event as { sdkSessionId: string }).sdkSessionId).toBe("sdk-123");
		});

		test("/session rename sends session_renamed", async () => {
			const { ws, run } = setup();
			await run("/session rename sdk-123 New title");
			const event = ws.events().find((e) => e.type === "session_renamed");
			expect(event).toBeDefined();
			expect((event as { sdkSessionId: string }).sdkSessionId).toBe("sdk-123");
			expect((event as { title: string }).title).toBe("New title");
		});

		test("/session rename updates the active session title used by /status", async () => {
			const { state, run } = setup();
			state.preparePrompt("Old title");
			state.completeRun({
				type: "done",
				sessionId: "sdk-123",
				durationMs: 10,
			});

			await run("/session rename sdk-123 New title");

			expect(state.createStatusEvent().sessionTitle).toBe("New title");
		});

		test("/session rename without args sends error", async () => {
			const { ws, run } = setup();
			await run("/session rename");
			const err = ws.events().find((e) => e.type === "error");
			expect(err).toBeDefined();
		});

		test("/session rename without title sends error", async () => {
			const { ws, run } = setup();
			await run("/session rename sdk-123");
			const err = ws.events().find((e) => e.type === "error");
			expect(err).toBeDefined();
		});

		test("/session delete without id sends error", async () => {
			const { ws, run } = setup();
			await run("/session delete");
			const err = ws.events().find((e) => e.type === "error");
			expect(err).toBeDefined();
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
			const state = new RuntimeState(PROVIDER_ID);
			hub.add(sender);
			hub.add(observer);

			await handleRuntimeCommand({
				command: "/model sonnet",
				createStatusEvent: () => state.createStatusEvent(),
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

		test("/session delete broadcasts deletion and active clear to all connected clients", async () => {
			const hub = new ClientHub();
			const sender = mockWs();
			const observer = mockWs();
			const state = new RuntimeState(PROVIDER_ID);
			hub.add(sender);
			hub.add(observer);
			state.preparePrompt("Current chat");
			state.completeRun({
				type: "done",
				sessionId: "sdk-active",
				durationMs: 1,
			});

			await handleRuntimeCommand({
				command: "/session delete sdk-active",
				createStatusEvent: () => state.createStatusEvent(),
				hub,
				replayHistoryToAll: async () => {},
				state,
				ws: sender,
			});

			expect(sender.events().find((e) => e.type === "session_deleted")).toEqual(
				{
					type: "session_deleted",
					sdkSessionId: "sdk-active",
				},
			);
			expect(
				observer.events().find((e) => e.type === "session_deleted"),
			).toEqual({
				type: "session_deleted",
				sdkSessionId: "sdk-active",
			});
			expect(sender.events().find((e) => e.type === "session_cleared")).toEqual(
				{
					type: "session_cleared",
				},
			);
			expect(
				observer.events().find((e) => e.type === "session_cleared"),
			).toEqual({
				type: "session_cleared",
			});
		});

		test("/session rename broadcasts to all connected clients", async () => {
			const hub = new ClientHub();
			const sender = mockWs();
			const observer = mockWs();
			const state = new RuntimeState(PROVIDER_ID);
			hub.add(sender);
			hub.add(observer);

			await handleRuntimeCommand({
				command: "/session rename sdk-123 Renamed",
				createStatusEvent: () => state.createStatusEvent(),
				hub,
				replayHistoryToAll: async () => {},
				state,
				ws: sender,
			});

			expect(sender.events().find((e) => e.type === "session_renamed")).toEqual(
				{
					type: "session_renamed",
					sdkSessionId: "sdk-123",
					title: "Renamed",
				},
			);
			expect(
				observer.events().find((e) => e.type === "session_renamed"),
			).toEqual({
				type: "session_renamed",
				sdkSessionId: "sdk-123",
				title: "Renamed",
			});
		});
	});
});
