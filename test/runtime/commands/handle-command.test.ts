import { afterEach, describe, expect, test } from "bun:test";
import type { ServerEvent } from "../../../src/common/protocol.ts";
import { RuntimeState } from "../../../src/runtime/application/runtime-state.ts";
import { SessionService } from "../../../src/runtime/application/session-service.ts";
import { handleRuntimeCommand } from "../../../src/runtime/commands/handle-command.ts";
import { SessionStore } from "../../../src/runtime/persistence/session-store.ts";
import {
	ClientHub,
	type WsClient,
} from "../../../src/runtime/transport/client-hub.ts";

const PROVIDER_ID = "mock";
const stores: SessionStore[] = [];

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
	const sessions = new SessionService(state);
	hub.add(ws);

	async function run(command: string) {
		await handleRuntimeCommand({
			command,
			createStatusEvent: () => state.createStatusEvent(),
			hub,
			replayHistoryToAll: async () => {},
			sessions,
			state,
			ws,
		});
	}

	return { hub, sessions, ws, state, run };
}

describe("handleRuntimeCommand", () => {
	afterEach(() => {
		for (const store of stores.splice(0)) {
			store.close();
		}
	});

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

		test("clears the persisted active session id", async () => {
			const hub = new ClientHub();
			const ws = mockWs();
			const store = new SessionStore(":memory:");
			stores.push(store);
			const state = new RuntimeState(PROVIDER_ID);
			const sessions = new SessionService(state, store);
			hub.add(ws);

			state.preparePrompt("hello");
			sessions.completeRun({
				type: "done",
				sessionId: "sdk-123",
				durationMs: 10,
			});
			expect(store.getActiveSessionId(PROVIDER_ID)).toBe("sdk-123");

			await handleRuntimeCommand({
				command: "/new",
				createStatusEvent: () => state.createStatusEvent(),
				hub,
				replayHistoryToAll: async () => {},
				sessions,
				state,
				ws,
			});

			expect(state.sessionId).toBeUndefined();
			expect(store.getActiveSessionId(PROVIDER_ID)).toBeUndefined();
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

		test("sends error when session storage throws", async () => {
			const hub = new ClientHub();
			const ws = mockWs();
			const state = new RuntimeState(PROVIDER_ID);
			hub.add(ws);
			const sessions = {
				activeSessionId: undefined,
				listSessions() {
					throw new Error("disk I/O error");
				},
			} as unknown as SessionService;

			await handleRuntimeCommand({
				command: "/session",
				createStatusEvent: () => state.createStatusEvent(),
				hub,
				replayHistoryToAll: async () => {},
				sessions,
				state,
				ws,
			});

			expect(ws.events()).toContainEqual({
				type: "error",
				message: "disk I/O error",
			});
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

		test("does not switch to cron sessions by prefix", async () => {
			const hub = new ClientHub();
			const ws = mockWs();
			const store = new SessionStore(":memory:");
			stores.push(store);
			const state = new RuntimeState(PROVIDER_ID);
			const sessions = new SessionService(state, store);
			hub.add(ws);

			store.upsert({
				providerId: PROVIDER_ID,
				sdkSessionId: "cron-session-1",
				title: "Daily summary",
				model: "haiku",
				tag: "cron",
			});

			await handleRuntimeCommand({
				command: "/session cron-session-1",
				createStatusEvent: () => state.createStatusEvent(),
				hub,
				replayHistoryToAll: async () => {},
				sessions,
				state,
				ws,
			});

			expect(state.sessionId).toBeUndefined();
			expect(ws.events().find((event) => event.type === "error")).toEqual({
				type: "error",
				message: "No session matching: cron-session-1",
			});
		});

		test("switches to a matching session beyond the recent session menu limit", async () => {
			const hub = new ClientHub();
			const ws = mockWs();
			const store = new SessionStore(":memory:");
			stores.push(store);
			const state = new RuntimeState(PROVIDER_ID);
			const sessions = new SessionService(state, store);
			hub.add(ws);

			for (let index = 0; index < 21; index++) {
				store.upsert({
					providerId: PROVIDER_ID,
					sdkSessionId: `sdk-${index.toString().padStart(2, "0")}`,
					title: `Session ${index}`,
					model: "sonnet",
				});
				await new Promise((resolve) => setTimeout(resolve, 2));
			}

			let replayedSessionId: string | undefined;
			await handleRuntimeCommand({
				command: "/session sdk-00",
				createStatusEvent: () => state.createStatusEvent(),
				hub,
				replayHistoryToAll: async (sessionId) => {
					replayedSessionId = sessionId;
				},
				sessions,
				state,
				ws,
			});

			expect(state.sessionId).toBe("sdk-00");
			expect(replayedSessionId).toBe("sdk-00");
			expect(
				ws.events().find((event) => event.type === "session_switched"),
			).toEqual({
				type: "session_switched",
				sdkSessionId: "sdk-00",
				title: "Session 0",
			});
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
				sessions: new SessionService(state),
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
			const sessions = new SessionService(state);
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
				sessions,
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
			const sessions = new SessionService(state);
			hub.add(sender);
			hub.add(observer);

			await handleRuntimeCommand({
				command: "/session rename sdk-123 Renamed",
				createStatusEvent: () => state.createStatusEvent(),
				hub,
				replayHistoryToAll: async () => {},
				sessions,
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
