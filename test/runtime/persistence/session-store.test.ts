import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SessionStore } from "../../../src/runtime/persistence/session-store.ts";

const TEST_DB = join(import.meta.dir, ".tmp-test.sqlite");
const CLAUDE_PROVIDER = "claude";
const MOCK_PROVIDER = "mock";
const LEGACY_PROVIDER = "legacy-provider";

function createTestStore(
	options?: ConstructorParameters<typeof SessionStore>[1],
) {
	return new SessionStore(TEST_DB, options);
}

describe("SessionStore", () => {
	afterEach(() => {
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
		if (existsSync(`${TEST_DB}-wal`)) rmSync(`${TEST_DB}-wal`);
		if (existsSync(`${TEST_DB}-shm`)) rmSync(`${TEST_DB}-shm`);
	});

	test("creates DB and tables on init", () => {
		const store = createTestStore();
		expect(existsSync(TEST_DB)).toBe(true);
		store.close();
	});

	test("upsert creates a new session", () => {
		const store = createTestStore();

		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "sdk-123",
			title: "Hello world",
			model: "sonnet",
		});

		const session = store.get(CLAUDE_PROVIDER, "sdk-123");
		expect(session).toBeDefined();
		expect(session?.providerId).toBe(CLAUDE_PROVIDER);
		expect(session?.title).toBe("Hello world");
		expect(session?.model).toBe("sonnet");
		expect(session?.createdAt).toBeGreaterThan(0);

		store.close();
	});

	test("upsert persists source", () => {
		const store = createTestStore();

		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "sdk-tg",
			title: "From Telegram",
			model: "opus",
			source: "telegram",
		});

		const session = store.get(CLAUDE_PROVIDER, "sdk-tg");
		expect(session?.source).toBe("telegram");

		store.close();
	});

	test("source defaults to tui when not provided", () => {
		const store = createTestStore();

		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "sdk-tui",
			title: "From TUI",
			model: "opus",
		});

		const session = store.get(CLAUDE_PROVIDER, "sdk-tui");
		expect(session?.source).toBe("tui");

		store.close();
	});

	test("tag defaults to chat when not provided", () => {
		const store = createTestStore();

		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "sdk-chat",
			title: "Interactive chat",
			model: "opus",
		});

		expect(store.get(CLAUDE_PROVIDER, "sdk-chat")?.tag).toBe("chat");

		store.close();
	});

	test("upsert persists cron tags", () => {
		const store = createTestStore();

		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "sdk-cron",
			title: "daily-summary",
			model: "haiku",
			tag: "cron",
		});

		expect(store.get(CLAUDE_PROVIDER, "sdk-cron")?.tag).toBe("cron");

		store.close();
	});

	test("upsert overwrites source on update", () => {
		const store = createTestStore();

		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "sdk-123",
			title: "First",
			model: "sonnet",
			source: "telegram",
		});
		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "sdk-123",
			title: "Updated",
			model: "opus",
			source: "tui",
		});

		const session = store.get(CLAUDE_PROVIDER, "sdk-123");
		expect(session?.title).toBe("Updated");
		expect(session?.source).toBe("tui");

		store.close();
	});

	test("persists last telegram chat id", () => {
		let store = createTestStore();
		store.setLastTelegramChatId(123);
		store.close();

		store = createTestStore();
		expect(store.getLastTelegramChatId()).toBe(123);

		store.close();
	});

	test("upsert updates existing session", () => {
		const store = createTestStore();

		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "sdk-123",
			title: "First",
			model: "sonnet",
		});
		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "sdk-123",
			title: "Updated",
			model: "opus",
		});

		const session = store.get(CLAUDE_PROVIDER, "sdk-123");
		expect(session?.title).toBe("Updated");
		expect(session?.model).toBe("opus");

		store.close();
	});

	test("list returns sessions ordered by last_active desc", async () => {
		const store = createTestStore();

		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "old",
			title: "Old",
			model: "haiku",
		});
		await new Promise((r) => setTimeout(r, 10));
		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "new",
			title: "New",
			model: "sonnet",
		});

		const sessions = store.list(20, undefined, CLAUDE_PROVIDER);
		expect(sessions.length).toBe(2);
		expect(sessions[0]?.sdkSessionId).toBe("new");

		store.close();
	});

	test("list filters by tag", async () => {
		const store = createTestStore();

		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "chat-1",
			title: "Chat",
			model: "opus",
		});
		await new Promise((r) => setTimeout(r, 10));
		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "cron-1",
			title: "daily-summary",
			model: "haiku",
			tag: "cron",
		});

		const chatOnly = store.list(20, "chat", CLAUDE_PROVIDER);
		expect(chatOnly.length).toBe(1);
		expect(chatOnly[0]?.sdkSessionId).toBe("chat-1");

		const all = store.list(20, undefined, CLAUDE_PROVIDER);
		expect(all.length).toBe(2);

		store.close();
	});

	test("list scopes sessions by provider", () => {
		const store = createTestStore();

		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "shared-id",
			title: "Claude chat",
			model: "opus",
		});
		store.upsert({
			providerId: MOCK_PROVIDER,
			sdkSessionId: "shared-id",
			title: "Mock chat",
			model: "haiku",
		});

		expect(store.list(20, undefined, CLAUDE_PROVIDER)).toHaveLength(1);
		expect(store.list(20, undefined, MOCK_PROVIDER)).toHaveLength(1);
		expect(store.get(CLAUDE_PROVIDER, "shared-id")?.title).toBe("Claude chat");
		expect(store.get(MOCK_PROVIDER, "shared-id")?.title).toBe("Mock chat");

		store.close();
	});

	test("delete removes a session", () => {
		const store = createTestStore();

		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "sdk-del",
			title: "To delete",
			model: "opus",
		});
		expect(store.get(CLAUDE_PROVIDER, "sdk-del")).toBeDefined();

		store.delete(CLAUDE_PROVIDER, "sdk-del");
		expect(store.get(CLAUDE_PROVIDER, "sdk-del")).toBeUndefined();
		expect(store.list(20, undefined, CLAUDE_PROVIDER).length).toBe(0);

		store.close();
	});

	test("rename updates session title", () => {
		const store = createTestStore();

		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "sdk-ren",
			title: "Old title",
			model: "opus",
		});

		store.rename(CLAUDE_PROVIDER, "sdk-ren", "New title");
		expect(store.get(CLAUDE_PROVIDER, "sdk-ren")?.title).toBe("New title");

		store.close();
	});

	test("getActiveSessionId / setActiveSessionId scopes by provider", () => {
		const store = createTestStore();

		expect(store.getActiveSessionId(CLAUDE_PROVIDER)).toBeUndefined();

		store.setActiveSessionId(CLAUDE_PROVIDER, "sdk-456");
		expect(store.getActiveSessionId(CLAUDE_PROVIDER)).toBe("sdk-456");

		store.setActiveSessionId(CLAUDE_PROVIDER, undefined);
		expect(store.getActiveSessionId(CLAUDE_PROVIDER)).toBeUndefined();

		store.close();
	});

	test("active session persists across instances per provider", () => {
		let store = createTestStore();
		store.setActiveSessionId(CLAUDE_PROVIDER, "sdk-789");
		store.setActiveSessionId(MOCK_PROVIDER, "sdk-999");
		store.close();

		store = createTestStore();
		expect(store.getActiveSessionId(CLAUDE_PROVIDER)).toBe("sdk-789");
		expect(store.getActiveSessionId(MOCK_PROVIDER)).toBe("sdk-999");
		store.close();
	});

	test("migrates legacy sessions tables by adding provider ownership", () => {
		const db = new Database(TEST_DB, { create: true });
		db.exec(`CREATE TABLE sessions (
			sdk_session_id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			model TEXT NOT NULL,
			source TEXT NOT NULL DEFAULT 'tui',
			created_at INTEGER NOT NULL,
			last_active INTEGER NOT NULL
		)`);
		db.exec(`CREATE TABLE state (
			key TEXT PRIMARY KEY,
			value TEXT
		)`);
		db.exec(`INSERT INTO sessions
			(sdk_session_id, title, model, source, created_at, last_active)
			VALUES ('sdk-legacy', 'Legacy', 'opus', 'tui', 1, 1)`);
		db.exec(
			"INSERT INTO state (key, value) VALUES ('active_session_id', 'sdk-legacy')",
		);
		db.close();

		const store = createTestStore({
			legacyProviderId: LEGACY_PROVIDER,
		});
		expect(store.get(LEGACY_PROVIDER, "sdk-legacy")).toMatchObject({
			providerId: LEGACY_PROVIDER,
			sdkSessionId: "sdk-legacy",
			tag: "chat",
		});
		expect(store.getActiveSessionId(LEGACY_PROVIDER)).toBe("sdk-legacy");
		expect(store.get(CLAUDE_PROVIDER, "sdk-legacy")).toBeUndefined();
		store.close();
	});

	test("setUsage and getUsage persist usage per provider session", () => {
		const store = createTestStore();

		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "sdk-1",
			title: "Chat",
			model: "opus",
		});

		const usage = {
			inputTokens: 100,
			outputTokens: 200,
			cacheCreationTokens: 50,
			cacheReadTokens: 25,
			contextWindow: 200000,
			maxOutputTokens: 32000,
			contextTokens: 1234,
			percentage: 1,
		};
		store.setUsage(CLAUDE_PROVIDER, "sdk-1", usage);

		const restored = store.getUsage(CLAUDE_PROVIDER, "sdk-1");
		expect(restored).toEqual(usage);

		store.close();
	});

	test("getUsage returns undefined for missing session", () => {
		const store = createTestStore();
		expect(store.getUsage(CLAUDE_PROVIDER, "nonexistent")).toBeUndefined();
		store.close();
	});

	test("getUsage returns undefined when no usage saved", () => {
		const store = createTestStore();
		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "sdk-1",
			title: "Chat",
			model: "opus",
		});
		expect(store.getUsage(CLAUDE_PROVIDER, "sdk-1")).toBeUndefined();
		store.close();
	});

	test("default journal mode avoids sqlite sidecar files", () => {
		const store = createTestStore();

		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "sdk-123",
			title: "Hello world",
			model: "sonnet",
		});
		store.close();

		expect(existsSync(`${TEST_DB}-wal`)).toBe(false);
		expect(existsSync(`${TEST_DB}-shm`)).toBe(false);
	});
});
