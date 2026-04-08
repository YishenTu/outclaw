import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SessionStore } from "../../../src/runtime/persistence/session-store.ts";

const TEST_DB = join(import.meta.dir, ".tmp-test.sqlite");

function createTestStore() {
	return new SessionStore(TEST_DB);
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
			sdkSessionId: "sdk-123",
			title: "Hello world",
			model: "sonnet",
		});

		const session = store.get("sdk-123");
		expect(session).toBeDefined();
		expect(session?.title).toBe("Hello world");
		expect(session?.model).toBe("sonnet");
		expect(session?.createdAt).toBeGreaterThan(0);

		store.close();
	});

	test("upsert persists source", () => {
		const store = createTestStore();

		store.upsert({
			sdkSessionId: "sdk-tg",
			title: "From Telegram",
			model: "opus",
			source: "telegram",
		});

		const session = store.get("sdk-tg");
		expect(session?.source).toBe("telegram");

		store.close();
	});

	test("source defaults to tui when not provided", () => {
		const store = createTestStore();

		store.upsert({
			sdkSessionId: "sdk-tui",
			title: "From TUI",
			model: "opus",
		});

		const session = store.get("sdk-tui");
		expect(session?.source).toBe("tui");

		store.close();
	});

	test("tag defaults to chat when not provided", () => {
		const store = createTestStore();

		store.upsert({
			sdkSessionId: "sdk-chat",
			title: "Interactive chat",
			model: "opus",
		});

		expect(store.get("sdk-chat")?.tag).toBe("chat");

		store.close();
	});

	test("upsert persists cron tags", () => {
		const store = createTestStore();

		store.upsert({
			sdkSessionId: "sdk-cron",
			title: "daily-summary",
			model: "haiku",
			tag: "cron",
		});

		expect(store.get("sdk-cron")?.tag).toBe("cron");

		store.close();
	});

	test("upsert overwrites source on update", () => {
		const store = createTestStore();

		store.upsert({
			sdkSessionId: "sdk-123",
			title: "First",
			model: "sonnet",
			source: "telegram",
		});
		store.upsert({
			sdkSessionId: "sdk-123",
			title: "Updated",
			model: "opus",
			source: "tui",
		});

		const session = store.get("sdk-123");
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

		store.upsert({ sdkSessionId: "sdk-123", title: "First", model: "sonnet" });
		store.upsert({ sdkSessionId: "sdk-123", title: "Updated", model: "opus" });

		const session = store.get("sdk-123");
		expect(session?.title).toBe("Updated");
		expect(session?.model).toBe("opus");

		store.close();
	});

	test("list returns sessions ordered by last_active desc", async () => {
		const store = createTestStore();

		store.upsert({ sdkSessionId: "old", title: "Old", model: "haiku" });
		await new Promise((r) => setTimeout(r, 10));
		store.upsert({ sdkSessionId: "new", title: "New", model: "sonnet" });

		const sessions = store.list();
		expect(sessions.length).toBe(2);
		expect(sessions[0]?.sdkSessionId).toBe("new");

		store.close();
	});

	test("getActiveSessionId / setActiveSessionId", () => {
		const store = createTestStore();

		expect(store.getActiveSessionId()).toBeUndefined();

		store.setActiveSessionId("sdk-456");
		expect(store.getActiveSessionId()).toBe("sdk-456");

		store.setActiveSessionId(undefined);
		expect(store.getActiveSessionId()).toBeUndefined();

		store.close();
	});

	test("active session persists across instances", () => {
		let store = createTestStore();
		store.setActiveSessionId("sdk-789");
		store.close();

		store = createTestStore();
		expect(store.getActiveSessionId()).toBe("sdk-789");
		store.close();
	});

	test("migrates legacy sessions tables by adding tag", () => {
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
		db.close();

		const store = createTestStore();
		store.upsert({
			sdkSessionId: "sdk-cron",
			title: "daily-summary",
			model: "haiku",
			tag: "cron",
		});

		expect(store.get("sdk-cron")?.tag).toBe("cron");

		store.close();
	});

	test("default journal mode avoids sqlite sidecar files", () => {
		const store = createTestStore();

		store.upsert({
			sdkSessionId: "sdk-123",
			title: "Hello world",
			model: "sonnet",
		});
		store.close();

		expect(existsSync(`${TEST_DB}-wal`)).toBe(false);
		expect(existsSync(`${TEST_DB}-shm`)).toBe(false);
	});
});
