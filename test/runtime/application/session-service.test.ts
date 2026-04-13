import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { DoneEvent } from "../../../src/common/protocol.ts";
import { RuntimeState } from "../../../src/runtime/application/runtime-state.ts";
import { SessionService } from "../../../src/runtime/application/session-service.ts";
import { SessionStore } from "../../../src/runtime/persistence/session-store.ts";

const TEST_DB = join(import.meta.dir, ".tmp-session-service-test.sqlite");
const PROVIDER_ID = "mock";
const OTHER_PROVIDER_ID = "claude";

function createTestStore() {
	return new SessionStore(TEST_DB, { journalMode: "DELETE" });
}

function makeDoneEvent(
	sessionId = "sdk-abc",
	overrides?: Partial<DoneEvent>,
): DoneEvent {
	return {
		type: "done",
		sessionId,
		durationMs: 100,
		usage: {
			inputTokens: 10,
			outputTokens: 5,
			cacheCreationTokens: 0,
			cacheReadTokens: 0,
			contextWindow: 200_000,
			maxOutputTokens: 8_000,
			contextTokens: 15,
			percentage: 7.5,
		},
		...overrides,
	};
}

function requireUsage(event: DoneEvent) {
	if (!event.usage) {
		throw new Error("Expected usage in test event");
	}
	return event.usage;
}

describe("SessionService", () => {
	afterEach(() => {
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
		if (existsSync(`${TEST_DB}-wal`)) rmSync(`${TEST_DB}-wal`);
		if (existsSync(`${TEST_DB}-shm`)) rmSync(`${TEST_DB}-shm`);
	});

	test("restores the active session from store", () => {
		const store = createTestStore();
		store.upsert({
			providerId: PROVIDER_ID,
			sdkSessionId: "sdk-456",
			title: "Stored title",
			model: "haiku",
			source: "telegram",
		});
		store.setActiveSessionId(PROVIDER_ID, "sdk-456");
		store.setLastTelegramChatId(123);
		store.setUsage(PROVIDER_ID, "sdk-456", requireUsage(makeDoneEvent()));

		const state = new RuntimeState(PROVIDER_ID);
		const sessions = new SessionService(state, store);

		expect(sessions.activeSessionId).toBe("sdk-456");
		expect(state.sessionTitle).toBe("Stored title");
		expect(state.model).toBe("haiku");
		expect(state.createStatusEvent().usage).toEqual(makeDoneEvent().usage);
		expect(state.createHeartbeatDeliveryTarget()).toEqual({
			clientType: "telegram",
			telegramChatId: 123,
		});

		store.close();
	});

	test("does not restore another provider's active session", () => {
		const store = createTestStore();
		store.upsert({
			providerId: OTHER_PROVIDER_ID,
			sdkSessionId: "sdk-456",
			title: "Other session",
			model: "haiku",
		});
		store.setActiveSessionId(OTHER_PROVIDER_ID, "sdk-456");

		const state = new RuntimeState(PROVIDER_ID);
		new SessionService(state, store);

		expect(state.sessionId).toBeUndefined();

		store.close();
	});

	test("completeRun persists the active session, usage, and active session id", () => {
		const store = createTestStore();
		const state = new RuntimeState(PROVIDER_ID);
		const sessions = new SessionService(state, store);

		state.preparePrompt("Hello world");
		sessions.completeRun(makeDoneEvent("sdk-123"));

		expect(store.getActiveSessionId(PROVIDER_ID)).toBe("sdk-123");
		expect(store.get(PROVIDER_ID, "sdk-123")).toMatchObject({
			title: "Hello world",
			model: "opus",
			source: "tui",
			tag: "chat",
		});
		expect(store.getUsage(PROVIDER_ID, "sdk-123")).toEqual(
			makeDoneEvent().usage,
		);

		store.close();
	});

	test("completeRun persists the last telegram chat id for telegram sessions", () => {
		const store = createTestStore();
		const state = new RuntimeState(PROVIDER_ID);
		const sessions = new SessionService(state, store);

		state.preparePrompt("from telegram");
		sessions.completeRun(makeDoneEvent("sdk-tg"), "telegram", 123);

		expect(store.get(PROVIDER_ID, "sdk-tg")).toMatchObject({
			source: "telegram",
		});
		expect(store.getLastTelegramChatId()).toBe(123);
		expect(state.createHeartbeatDeliveryTarget()).toEqual({
			clientType: "telegram",
			telegramChatId: 123,
		});

		store.close();
	});

	test("switchToSession restores usage and updates the active session id", () => {
		const store = createTestStore();
		const usage = requireUsage(makeDoneEvent());
		store.upsert({
			providerId: PROVIDER_ID,
			sdkSessionId: "sdk-old",
			title: "Old chat",
			model: "sonnet",
			source: "tui",
		});
		store.setUsage(PROVIDER_ID, "sdk-old", usage);

		const state = new RuntimeState(PROVIDER_ID);
		const sessions = new SessionService(state, store);
		const match = sessions.switchToSession("sdk-old");

		expect(match?.sdkSessionId).toBe("sdk-old");
		expect(state.sessionId).toBe("sdk-old");
		expect(state.createStatusEvent().usage).toEqual(usage);
		expect(store.getActiveSessionId(PROVIDER_ID)).toBe("sdk-old");

		store.close();
	});

	test("switchToSession ignores cron sessions", () => {
		const store = createTestStore();
		store.upsert({
			providerId: PROVIDER_ID,
			sdkSessionId: "cron-session-1",
			title: "Daily summary",
			model: "haiku",
			tag: "cron",
		});

		const state = new RuntimeState(PROVIDER_ID);
		const sessions = new SessionService(state, store);
		const match = sessions.switchToSession("cron-session-1");

		expect(match).toBeUndefined();
		expect(state.sessionId).toBeUndefined();
		expect(store.getActiveSessionId(PROVIDER_ID)).toBeUndefined();

		store.close();
	});

	test("renameSession persists the updated title", () => {
		const store = createTestStore();
		const state = new RuntimeState(PROVIDER_ID);
		const sessions = new SessionService(state, store);

		state.preparePrompt("Old title");
		sessions.completeRun(makeDoneEvent("sdk-123"));
		sessions.renameSession("sdk-123", "Renamed");

		expect(state.sessionTitle).toBe("Renamed");
		expect(store.get(PROVIDER_ID, "sdk-123")?.title).toBe("Renamed");

		store.close();
	});

	test("deleteSession clears the active session id in memory and store", () => {
		const store = createTestStore();
		const state = new RuntimeState(PROVIDER_ID);
		const sessions = new SessionService(state, store);

		state.preparePrompt("Current chat");
		sessions.completeRun(makeDoneEvent("sdk-active"));

		expect(sessions.deleteSession("sdk-active")).toEqual({
			clearedActiveSession: true,
		});
		expect(state.sessionId).toBeUndefined();
		expect(store.getActiveSessionId(PROVIDER_ID)).toBeUndefined();
		expect(store.get(PROVIDER_ID, "sdk-active")).toBeUndefined();

		store.close();
	});

	test("clearActiveSession clears the active session id in memory and store", () => {
		const store = createTestStore();
		const state = new RuntimeState(PROVIDER_ID);
		const sessions = new SessionService(state, store);

		state.preparePrompt("Current chat");
		sessions.completeRun(makeDoneEvent("sdk-active"));

		sessions.clearActiveSession();

		expect(state.sessionId).toBeUndefined();
		expect(store.getActiveSessionId(PROVIDER_ID)).toBeUndefined();
		expect(store.get(PROVIDER_ID, "sdk-active")).toBeDefined();

		store.close();
	});

	test("recordCronRun persists a cron-tagged session without replacing the active session", () => {
		const store = createTestStore();
		const state = new RuntimeState(PROVIDER_ID);
		const sessions = new SessionService(state, store);

		state.preparePrompt("main prompt");
		sessions.completeRun(makeDoneEvent("sdk-main"));
		sessions.recordCronRun({
			sessionId: "cron-session-1",
			jobName: "daily-summary",
			model: "haiku",
		});

		expect(store.get(PROVIDER_ID, "cron-session-1")).toMatchObject({
			title: "daily-summary",
			model: "haiku",
			tag: "cron",
		});
		expect(store.getActiveSessionId(PROVIDER_ID)).toBe("sdk-main");

		store.close();
	});
});
