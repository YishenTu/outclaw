import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { DoneEvent } from "../../../src/common/protocol.ts";
import { SessionService } from "../../../src/runtime/application/session-service.ts";
import { RuntimeState } from "../../../src/runtime/application/state/runtime-state.ts";
import { SessionStore } from "../../../src/runtime/persistence/session-store/session-store.ts";

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

function expectedRestoredUsage() {
	return requireUsage(makeDoneEvent());
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
		store.setLastUserTarget({
			kind: "telegram",
			chatId: 123,
		});
		store.setUsage(PROVIDER_ID, "sdk-456", requireUsage(makeDoneEvent()));

		const state = new RuntimeState(PROVIDER_ID);
		const sessions = new SessionService(state, store);

		expect(sessions.activeSessionId).toBe("sdk-456");
		expect(state.sessionTitle).toBe("Stored title");
		expect(state.model).toBe("haiku");
		expect(state.createStatusEvent().usage).toEqual(expectedRestoredUsage());
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

	test("restores blank-session provider model effort and service tier from store", () => {
		const store = createTestStore();
		store.setBlankChatModelSelection({
			providerId: "codex",
			model: "gpt-5.5",
			effort: "low",
			serviceTier: "priority",
		});

		const state = new RuntimeState(PROVIDER_ID);
		new SessionService(state, store);

		expect(state.providerId).toBe("codex");
		expect(state.model).toBe("gpt-5.5");
		expect(state.effort).toBe("low");
		expect(state.createStatusEvent().serviceTier).toBe("priority");

		store.close();
	});

	test("completeRun persists the active session, usage, and active session id", () => {
		const store = createTestStore();
		const state = new RuntimeState(PROVIDER_ID);
		const sessions = new SessionService(state, store);

		state.preparePrompt("Hello world");
		state.setServiceTier("priority");
		sessions.completeRun(makeDoneEvent("sdk-123"));

		expect(store.getActiveSessionId(PROVIDER_ID)).toBe("sdk-123");
		expect(store.get(PROVIDER_ID, "sdk-123")).toMatchObject({
			title: "Hello world",
			model: "",
			serviceTier: "priority",
			source: "tui",
			tag: "chat",
		});
		expect(store.getUsage(PROVIDER_ID, "sdk-123")).toEqual(
			makeDoneEvent().usage,
		);

		store.close();
	});

	test("recordAcceptedPromptTarget persists the last user target for telegram prompts", () => {
		const store = createTestStore();
		const state = new RuntimeState(PROVIDER_ID);
		const sessions = new SessionService(state, store);

		sessions.recordAcceptedPromptTarget("telegram", 123);

		expect(store.getLastUserTarget()).toEqual({
			kind: "telegram",
			chatId: 123,
		});
		expect(store.getLastInteractiveAt()).toBeGreaterThan(0);
		expect(state.createHeartbeatDeliveryTarget()).toEqual({
			clientType: "telegram",
			telegramChatId: 123,
		});

		store.close();
	});

	test("accepted interactive prompts clear a pending rollover notice", () => {
		const store = createTestStore();
		const state = new RuntimeState(PROVIDER_ID);
		const sessions = new SessionService(state, store);
		store.setRolloverNotice({
			kind: "rollover",
			message: "Previous session auto-finalized after 8h idle.",
		});

		sessions.recordAcceptedPromptTarget("tui");

		expect(store.getRolloverNotice()).toBeUndefined();
		store.close();
	});

	test("beginRolloverAttempt marks the idle epoch handled, clears the active session, and stores a notice", () => {
		const store = createTestStore();
		const state = new RuntimeState(PROVIDER_ID);
		const sessions = new SessionService(state, store);

		store.setLastInteractiveAt(123);
		state.preparePrompt("Current chat");
		sessions.completeRun(makeDoneEvent("sdk-active"));

		sessions.beginRolloverAttempt(480);

		expect(store.getLastHandledRolloverInteractiveAt()).toBe(123);
		expect(store.getActiveSessionId(PROVIDER_ID)).toBeUndefined();
		expect(state.sessionId).toBeUndefined();
		expect(store.getRolloverNotice()).toEqual({
			kind: "rollover",
			message:
				"Previous session auto-finalized after 8h idle. A new session will begin with your next message. Use /session to resume.",
		});

		store.close();
	});

	test("finishRolloverAttempt upgrades the notice when the background finalize fails", () => {
		const store = createTestStore();
		const state = new RuntimeState(PROVIDER_ID);
		const sessions = new SessionService(state, store);

		sessions.beginRolloverAttempt(480);
		sessions.finishRolloverAttempt({
			failed: true,
			idleMinutes: 480,
		});

		expect(store.getRolloverNotice()).toEqual({
			kind: "rollover",
			message:
				"Previous session auto-finalized after 8h idle. Final check failed. A new session will begin with your next message. Use /session to resume.",
			finalCheck: "failed",
		});

		store.close();
	});

	test("recordBackgroundCompletion persists an inactive session without replacing the active one", () => {
		const store = createTestStore();
		store.upsert({
			providerId: PROVIDER_ID,
			sdkSessionId: "sdk-beta",
			title: "Current chat",
			model: "sonnet",
			source: "tui",
		});
		store.setActiveSessionId(PROVIDER_ID, "sdk-beta");
		const state = new RuntimeState(PROVIDER_ID);
		const sessions = new SessionService(state, store);

		sessions.recordBackgroundCompletion({
			event: makeDoneEvent("sdk-alpha"),
			model: "opus",
			source: "telegram",
			title: "Background chat",
		});

		expect(store.getActiveSessionId(PROVIDER_ID)).toBe("sdk-beta");
		expect(state.sessionId).toBe("sdk-beta");
		expect(store.get(PROVIDER_ID, "sdk-alpha")).toMatchObject({
			title: "Background chat",
			model: "opus",
			source: "telegram",
			tag: "chat",
		});
		expect(store.getUsage(PROVIDER_ID, "sdk-alpha")).toEqual(
			requireUsage(makeDoneEvent()),
		);

		store.close();
	});

	test("recordBackgroundCompletion writes to the run provider after visible provider changes", () => {
		const store = createTestStore();
		const state = new RuntimeState(PROVIDER_ID);
		const sessions = new SessionService(state, store);

		state.setProvider(OTHER_PROVIDER_ID);
		sessions.recordBackgroundCompletion({
			providerId: PROVIDER_ID,
			event: makeDoneEvent("same-sdk-id"),
			model: "opus",
			source: "tui",
			title: "Hidden provider run",
		});

		expect(store.get(PROVIDER_ID, "same-sdk-id")).toMatchObject({
			providerId: PROVIDER_ID,
			sdkSessionId: "same-sdk-id",
			title: "Hidden provider run",
		});
		expect(store.get(OTHER_PROVIDER_ID, "same-sdk-id")).toBeUndefined();

		store.close();
	});

	test("refreshTranscript and applyAutoTitle write to the run provider", async () => {
		const store = createTestStore();
		const state = new RuntimeState(PROVIDER_ID);
		const sessions = new SessionService(state, store);

		store.upsert({
			providerId: PROVIDER_ID,
			sdkSessionId: "same-sdk-id",
			title: "Pending",
			model: "opus",
		});
		store.upsert({
			providerId: OTHER_PROVIDER_ID,
			sdkSessionId: "same-sdk-id",
			title: "Other pending",
			model: "gpt-5.5",
		});
		store.upsert({
			providerId: PROVIDER_ID,
			sdkSessionId: "same-cron-id",
			title: "Pending cron",
			model: "opus",
			tag: "cron",
		});
		store.upsert({
			providerId: OTHER_PROVIDER_ID,
			sdkSessionId: "same-cron-id",
			title: "Other pending cron",
			model: "gpt-5.5",
			tag: "cron",
		});
		state.setProvider(OTHER_PROVIDER_ID);

		await sessions.refreshTranscript(PROVIDER_ID, "same-cron-id", async () => [
			{
				role: "assistant",
				content: "provider-owned transcript",
				timestamp: 123,
			},
		]);
		expect(
			store
				.listCronRunsByTitle("Pending cron", { limit: 10 })
				.find((entry) => entry.providerId === PROVIDER_ID)?.resultText,
		).toBe("provider-owned transcript");
		expect(
			store
				.listCronRunsByTitle("Other pending cron", { limit: 10 })
				.find((entry) => entry.providerId === OTHER_PROVIDER_ID)?.resultText,
		).toBe("");

		expect(
			sessions.applyAutoTitle({
				providerId: PROVIDER_ID,
				sessionId: "same-sdk-id",
				expectedTitle: "Pending",
				title: "Renamed by run provider",
			}),
		).toBe(true);
		expect(store.get(PROVIDER_ID, "same-sdk-id")?.title).toBe(
			"Renamed by run provider",
		);
		expect(store.get(OTHER_PROVIDER_ID, "same-sdk-id")?.title).toBe(
			"Other pending",
		);

		store.close();
	});

	test("accepted tui prompts overwrite a prior telegram target immediately", () => {
		const store = createTestStore();
		const state = new RuntimeState(PROVIDER_ID);
		const sessions = new SessionService(state, store);

		sessions.recordAcceptedPromptTarget("telegram", 123);
		sessions.recordAcceptedPromptTarget("tui");

		expect(store.getLastUserTarget()).toEqual({ kind: "tui" });
		expect(state.createHeartbeatDeliveryTarget()).toEqual({
			clientType: "tui",
		});

		store.close();
	});

	test("agent-originated runs do not mutate the last user target", () => {
		const store = createTestStore();
		const state = new RuntimeState(PROVIDER_ID);
		const sessions = new SessionService(state, store);

		sessions.recordAcceptedPromptTarget("telegram", 123);
		state.preparePrompt("from agent");
		sessions.completeRun(makeDoneEvent("sdk-agent"), "agent");

		expect(store.getLastUserTarget()).toEqual({
			kind: "telegram",
			chatId: 123,
		});
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
		expect(state.createStatusEvent().usage).toEqual(expectedRestoredUsage());
		expect(store.getActiveSessionId(PROVIDER_ID)).toBe("sdk-old");

		store.close();
	});

	test("restores the persisted active provider without changing blank selection", () => {
		const store = createTestStore();
		store.setBlankChatModelSelection({
			providerId: PROVIDER_ID,
			model: "pi-default",
			effort: "medium",
		});
		store.upsert({
			providerId: OTHER_PROVIDER_ID,
			sdkSessionId: "sdk-legacy",
			title: "Legacy chat",
			model: "opus",
			source: "tui",
		});
		store.setActiveSessionId(OTHER_PROVIDER_ID, "sdk-legacy");
		store.setActiveChatProviderId(OTHER_PROVIDER_ID);

		const state = new RuntimeState(PROVIDER_ID);
		new SessionService(
			state,
			store,
			{},
			{
				defaultBlankSelection: {
					providerId: PROVIDER_ID,
					model: "pi-default",
					effort: "medium",
				},
				writableProviderIds: new Set([PROVIDER_ID]),
			},
		);

		expect(state.providerId).toBe(OTHER_PROVIDER_ID);
		expect(state.sessionId).toBe("sdk-legacy");
		expect(state.model).toBe("opus");
		expect(store.getBlankChatModelSelection()).toEqual({
			providerId: PROVIDER_ID,
			model: "pi-default",
			effort: "medium",
		});

		store.close();
	});

	test("derives missing active provider from legacy blank selection during restore", () => {
		const store = createTestStore();
		store.setBlankChatModelSelection({
			providerId: OTHER_PROVIDER_ID,
			model: "opus",
			effort: "medium",
		});
		store.upsert({
			providerId: OTHER_PROVIDER_ID,
			sdkSessionId: "sdk-legacy",
			title: "Legacy chat",
			model: "opus",
			source: "tui",
		});
		store.setActiveSessionId(OTHER_PROVIDER_ID, "sdk-legacy");

		const state = new RuntimeState(PROVIDER_ID);
		new SessionService(
			state,
			store,
			{},
			{
				defaultBlankSelection: {
					providerId: PROVIDER_ID,
					model: "pi-default",
					effort: "medium",
				},
				writableProviderIds: new Set([PROVIDER_ID]),
			},
		);

		expect(state.providerId).toBe(OTHER_PROVIDER_ID);
		expect(state.sessionId).toBe("sdk-legacy");
		expect(state.model).toBe("opus");
		expect(store.getActiveChatProviderId()).toBe(OTHER_PROVIDER_ID);
		expect(store.getBlankChatModelSelection()).toEqual({
			providerId: PROVIDER_ID,
			model: "pi-default",
			effort: "medium",
		});

		store.close();
	});

	test("clears stale persisted active provider state when the session is missing", () => {
		const store = createTestStore();
		store.setBlankChatModelSelection({
			providerId: PROVIDER_ID,
			model: "pi-default",
			effort: "medium",
		});
		store.setActiveSessionId(OTHER_PROVIDER_ID, "deleted-legacy");
		store.setActiveChatProviderId(OTHER_PROVIDER_ID);

		const state = new RuntimeState(PROVIDER_ID);
		new SessionService(
			state,
			store,
			{},
			{
				defaultBlankSelection: {
					providerId: PROVIDER_ID,
					model: "pi-default",
					effort: "medium",
				},
				writableProviderIds: new Set([PROVIDER_ID]),
			},
		);

		expect(state.providerId).toBe(PROVIDER_ID);
		expect(state.sessionId).toBeUndefined();
		expect(store.getActiveChatProviderId()).toBeUndefined();
		expect(store.getActiveSessionId(OTHER_PROVIDER_ID)).toBeUndefined();

		store.close();
	});

	test("switchToSession does not report a catalog change for active-session-only switches", () => {
		const store = createTestStore();
		store.upsert({
			providerId: PROVIDER_ID,
			sdkSessionId: "sdk-old",
			title: "Old chat",
			model: "sonnet",
			source: "tui",
		});

		let activeSessionId: string | undefined;
		let catalogChanges = 0;
		let stateChanges = 0;
		const state = new RuntimeState(PROVIDER_ID);
		const sessions = new SessionService(state, store, {
			onActiveSessionChanged: (event) => {
				activeSessionId = event.activeSessionId;
			},
			onSessionCatalogChanged: () => {
				catalogChanges += 1;
			},
			onSessionStateChange: () => {
				stateChanges += 1;
			},
		});

		const match = sessions.switchToSession("sdk-old");

		expect(match?.sdkSessionId).toBe("sdk-old");
		expect(state.sessionId).toBe("sdk-old");
		expect(activeSessionId).toBe("sdk-old");
		expect(stateChanges).toBe(1);
		expect(catalogChanges).toBe(0);

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

	test("listSessions returns nextCursor when the requested page is full", () => {
		const store = createTestStore();
		const state = new RuntimeState(PROVIDER_ID);
		const sessions = new SessionService(state, store);

		for (const params of [
			{ sdkSessionId: "sdk-a", title: "A", timestamp: 300 },
			{ sdkSessionId: "sdk-b", title: "B", timestamp: 300 },
			{ sdkSessionId: "sdk-c", title: "C", timestamp: 200 },
		]) {
			store.upsert({
				providerId: PROVIDER_ID,
				sdkSessionId: params.sdkSessionId,
				title: params.title,
				model: "sonnet",
				timestamp: params.timestamp,
			});
		}

		const firstPage = sessions.listSessions({ limit: 2 });
		expect(firstPage.sessions.map((session) => session.sdkSessionId)).toEqual([
			"sdk-a",
			"sdk-b",
		]);
		expect(firstPage.nextCursor).toEqual({
			lastActive: 300,
			providerId: PROVIDER_ID,
			sdkSessionId: "sdk-b",
		});

		const secondPage = sessions.listSessions({
			cursor: firstPage.nextCursor,
			limit: 2,
		});
		expect(secondPage.sessions.map((session) => session.sdkSessionId)).toEqual([
			"sdk-c",
		]);
		expect(secondPage.nextCursor).toBeUndefined();
		store.close();
	});

	test("listSessions includes chat history across providers by default", () => {
		const store = createTestStore();
		const state = new RuntimeState(PROVIDER_ID);
		const sessions = new SessionService(state, store);

		store.upsert({
			providerId: PROVIDER_ID,
			sdkSessionId: "sdk-pi",
			title: "Pi chat",
			model: "pi-default",
			timestamp: 200,
		});
		store.upsert({
			providerId: OTHER_PROVIDER_ID,
			sdkSessionId: "sdk-legacy",
			title: "Legacy chat",
			model: "opus",
			timestamp: 300,
		});

		expect(
			sessions
				.listSessions()
				.sessions.map((session) => [session.providerId, session.sdkSessionId]),
		).toEqual([
			[OTHER_PROVIDER_ID, "sdk-legacy"],
			[PROVIDER_ID, "sdk-pi"],
		]);

		store.close();
	});

	test("listSessions paginates same-id sessions across providers", () => {
		const store = createTestStore();
		const state = new RuntimeState(PROVIDER_ID);
		const sessions = new SessionService(state, store);

		for (const providerId of [OTHER_PROVIDER_ID, PROVIDER_ID]) {
			store.upsert({
				providerId,
				sdkSessionId: "same-sdk-id",
				title: `${providerId} chat`,
				model: providerId === OTHER_PROVIDER_ID ? "opus" : "pi-default",
				timestamp: 300,
			});
		}

		const firstPage = sessions.listSessions({ limit: 1 });
		expect(firstPage.sessions).toEqual([
			expect.objectContaining({
				providerId: OTHER_PROVIDER_ID,
				sdkSessionId: "same-sdk-id",
			}),
		]);
		expect(firstPage.nextCursor).toEqual({
			lastActive: 300,
			providerId: OTHER_PROVIDER_ID,
			sdkSessionId: "same-sdk-id",
		});

		const secondPage = sessions.listSessions({
			cursor: firstPage.nextCursor,
			limit: 1,
		});
		expect(secondPage.sessions).toEqual([
			expect.objectContaining({
				providerId: PROVIDER_ID,
				sdkSessionId: "same-sdk-id",
			}),
		]);

		store.close();
	});

	test("searchSessions matches titles across the agent provider scope", () => {
		const store = createTestStore();
		const state = new RuntimeState(PROVIDER_ID);
		const sessions = new SessionService(state, store);

		store.upsert({
			providerId: PROVIDER_ID,
			sdkSessionId: "sdk-auth",
			title: "Refactor auth middleware",
			model: "sonnet",
			timestamp: 300,
		});
		store.upsert({
			providerId: PROVIDER_ID,
			sdkSessionId: "sdk-auth-only",
			title: "Auth handlers",
			model: "sonnet",
			timestamp: 200,
		});
		store.upsert({
			providerId: OTHER_PROVIDER_ID,
			sdkSessionId: "sdk-other-provider",
			title: "Refactor auth middleware",
			model: "opus",
			timestamp: 400,
		});

		expect(
			sessions
				.searchSessions({ query: "auth middle" })
				.sessions.map((session) => [session.providerId, session.sdkSessionId]),
		).toEqual([
			[OTHER_PROVIDER_ID, "sdk-other-provider"],
			[PROVIDER_ID, "sdk-auth"],
		]);
		expect(sessions.searchSessions({ query: "auth foo" })).toEqual({
			sessions: [],
		});
		expect(sessions.searchSessions({ query: "   " })).toEqual({
			sessions: [],
		});
		store.close();
	});

	test("searchSessions case-folds non-ASCII title tokens", () => {
		const store = createTestStore();
		const state = new RuntimeState(PROVIDER_ID);
		const sessions = new SessionService(state, store);

		store.upsert({
			providerId: PROVIDER_ID,
			sdkSessionId: "sdk-munich",
			title: "MÜNCHEN Überprüfung",
			model: "sonnet",
			timestamp: 300,
		});

		expect(
			sessions
				.searchSessions({ query: "münchen überprüfung" })
				.sessions.map((session) => session.sdkSessionId),
		).toEqual(["sdk-munich"]);
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

	test("deleteSession restores writable blank selection after deleting an active legacy session", () => {
		const store = createTestStore();
		store.setBlankChatModelSelection({
			providerId: PROVIDER_ID,
			model: "pi-default",
			effort: "medium",
		});
		store.upsert({
			providerId: OTHER_PROVIDER_ID,
			sdkSessionId: "sdk-legacy",
			title: "Legacy chat",
			model: "opus",
		});
		const state = new RuntimeState(PROVIDER_ID);
		const sessions = new SessionService(
			state,
			store,
			{},
			{
				defaultBlankSelection: {
					providerId: PROVIDER_ID,
					model: "pi-default",
					effort: "medium",
				},
				writableProviderIds: new Set([PROVIDER_ID]),
			},
		);
		const legacy = store.get(OTHER_PROVIDER_ID, "sdk-legacy");
		if (!legacy) {
			throw new Error("Expected legacy session");
		}
		sessions.switchToResolvedSession(legacy);

		expect(sessions.deleteSession("sdk-legacy")).toEqual({
			clearedActiveSession: true,
		});

		expect(state.providerId).toBe(PROVIDER_ID);
		expect(state.sessionId).toBeUndefined();
		expect(store.getActiveSessionId(OTHER_PROVIDER_ID)).toBeUndefined();
		expect(store.getActiveChatProviderId()).toBeUndefined();

		store.close();
	});

	test("deleteResolvedSession restores writable blank selection after deleting an active legacy session", () => {
		const store = createTestStore();
		store.setBlankChatModelSelection({
			providerId: PROVIDER_ID,
			model: "pi-default",
			effort: "medium",
		});
		store.upsert({
			providerId: OTHER_PROVIDER_ID,
			sdkSessionId: "sdk-legacy",
			title: "Legacy chat",
			model: "opus",
		});
		const state = new RuntimeState(PROVIDER_ID);
		const sessions = new SessionService(
			state,
			store,
			{},
			{
				defaultBlankSelection: {
					providerId: PROVIDER_ID,
					model: "pi-default",
					effort: "medium",
				},
				writableProviderIds: new Set([PROVIDER_ID]),
			},
		);
		const legacy = store.get(OTHER_PROVIDER_ID, "sdk-legacy");
		if (!legacy) {
			throw new Error("Expected legacy session");
		}
		sessions.switchToResolvedSession(legacy);

		expect(sessions.deleteResolvedSession(legacy)).toEqual({
			clearedActiveSession: true,
		});

		expect(state.providerId).toBe(PROVIDER_ID);
		expect(state.sessionId).toBeUndefined();
		expect(store.getActiveSessionId(OTHER_PROVIDER_ID)).toBeUndefined();
		expect(store.getActiveChatProviderId()).toBeUndefined();

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
			ranAt: 1234,
		});

		expect(store.get(PROVIDER_ID, "cron-session-1")).toMatchObject({
			title: "daily-summary",
			model: "haiku",
			tag: "cron",
		});
		expect(store.getActiveSessionId(PROVIDER_ID)).toBe("sdk-main");
		expect(store.listCronRunsByTitle("daily-summary", { limit: 1 })).toEqual([
			{
				providerId: PROVIDER_ID,
				sessionId: "cron-session-1",
				ranAt: 1234,
				resultText: "",
			},
		]);

		store.close();
	});

	test("recordCronRun can persist fallback result text for failed cron runs", () => {
		const store = createTestStore();
		const state = new RuntimeState(PROVIDER_ID);
		const sessions = new SessionService(state, store);

		sessions.recordCronRun({
			sessionId: "cron-session-error",
			jobName: "daily-summary",
			model: "haiku",
			ranAt: 1234,
			resultText: "[error] agent exploded",
			failure: {
				failedAt: 1234,
				message: "agent exploded",
			},
		});

		expect(store.get(PROVIDER_ID, "cron-session-error")).toMatchObject({
			failedAt: 1234,
			failureMessage: "agent exploded",
		});
		expect(store.listCronRunsByTitle("daily-summary", { limit: 1 })).toEqual([
			{
				providerId: PROVIDER_ID,
				sessionId: "cron-session-error",
				ranAt: 1234,
				resultText: "[error] agent exploded",
			},
		]);

		store.close();
	});

	test("recordCronRun writes to the cron result provider", () => {
		const store = createTestStore();
		const state = new RuntimeState(PROVIDER_ID);
		const sessions = new SessionService(state, store);
		state.setProvider(OTHER_PROVIDER_ID);

		sessions.recordCronRun({
			providerId: PROVIDER_ID,
			sessionId: "cron-session-provider",
			jobName: "daily-summary",
			model: "haiku",
			ranAt: 1234,
			resultText: "cron summary",
		});

		expect(store.get(PROVIDER_ID, "cron-session-provider")).toMatchObject({
			title: "daily-summary",
			tag: "cron",
		});
		expect(
			store.get(OTHER_PROVIDER_ID, "cron-session-provider"),
		).toBeUndefined();
		expect(store.listCronRunsByTitle("daily-summary", { limit: 1 })).toEqual([
			{
				providerId: PROVIDER_ID,
				sessionId: "cron-session-provider",
				ranAt: 1234,
				resultText: "cron summary",
			},
		]);

		store.close();
	});
});
