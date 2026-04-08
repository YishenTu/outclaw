import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SessionManager } from "../../../src/runtime/persistence/session-manager.ts";
import { SessionStore } from "../../../src/runtime/persistence/session-store.ts";

const TEST_DB = join(import.meta.dir, ".tmp-session-test.sqlite");

function createTestStore() {
	return new SessionStore(TEST_DB, { journalMode: "DELETE" });
}

describe("SessionManager", () => {
	afterEach(() => {
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
		if (existsSync(`${TEST_DB}-wal`)) rmSync(`${TEST_DB}-wal`);
		if (existsSync(`${TEST_DB}-shm`)) rmSync(`${TEST_DB}-shm`);
	});

	test("starts with no active session (no store)", () => {
		const session = new SessionManager();
		expect(session.id).toBeUndefined();
	});

	test("tracks session after update", () => {
		const session = new SessionManager();
		session.update("session-abc", "sonnet");
		expect(session.id).toBe("session-abc");
	});

	test("clears session", () => {
		const session = new SessionManager();
		session.update("session-abc", "sonnet");
		session.clear();
		expect(session.id).toBeUndefined();
	});

	test("persists to store on update", () => {
		const store = createTestStore();
		const session = new SessionManager(store);

		session.setTitle("Hello world");
		session.update("sdk-123", "opus");

		const row = store.get("sdk-123");
		expect(row?.title).toBe("Hello world");
		expect(row?.model).toBe("opus");
		expect(store.getActiveSessionId()).toBe("sdk-123");

		store.close();
	});

	test("restores active session from store", () => {
		const store = createTestStore();
		store.setActiveSessionId("sdk-456");

		const session = new SessionManager(store);
		expect(session.id).toBe("sdk-456");

		store.close();
	});

	test("restores stored title for the active session", () => {
		const store = createTestStore();
		store.upsert({
			sdkSessionId: "sdk-456",
			title: "Stored title",
			model: "haiku",
		});
		store.setActiveSessionId("sdk-456");

		const session = new SessionManager(store);
		expect(session.id).toBe("sdk-456");
		expect(session.title).toBe("Stored title");

		store.close();
	});

	test("keeps stored title when resuming an existing session", () => {
		let store = createTestStore();
		store.upsert({
			sdkSessionId: "sdk-123",
			title: "Original title",
			model: "sonnet",
		});
		store.setActiveSessionId("sdk-123");
		store.close();

		store = createTestStore();
		const session = new SessionManager(store);
		session.update("sdk-123", "opus");

		expect(store.get("sdk-123")?.title).toBe("Original title");
		expect(store.get("sdk-123")?.model).toBe("opus");

		store.close();
	});

	test("preserves stored session tags on update", () => {
		const store = createTestStore();
		store.upsert({
			sdkSessionId: "sdk-cron",
			title: "Daily summary",
			model: "haiku",
			tag: "cron",
		});
		store.setActiveSessionId("sdk-cron");

		const session = new SessionManager(store);
		session.update("sdk-cron", "opus");

		expect(store.get("sdk-cron")?.tag).toBe("cron");

		store.close();
	});

	test("clear removes active from store", () => {
		const store = createTestStore();
		const session = new SessionManager(store);

		session.update("sdk-123", "sonnet");
		session.clear();

		expect(store.getActiveSessionId()).toBeUndefined();

		store.close();
	});
});
