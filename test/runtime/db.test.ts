import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SessionStore } from "../../src/runtime/db.ts";

const TEST_DB = join(import.meta.dir, ".tmp-test.sqlite");

describe("SessionStore", () => {
	afterEach(() => {
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
	});

	test("creates DB and tables on init", () => {
		const store = new SessionStore(TEST_DB);
		expect(existsSync(TEST_DB)).toBe(true);
		store.close();
	});

	test("upsert creates a new session", () => {
		const store = new SessionStore(TEST_DB);

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

	test("upsert updates existing session", () => {
		const store = new SessionStore(TEST_DB);

		store.upsert({ sdkSessionId: "sdk-123", title: "First", model: "sonnet" });
		store.upsert({ sdkSessionId: "sdk-123", title: "Updated", model: "opus" });

		const session = store.get("sdk-123");
		expect(session?.title).toBe("Updated");
		expect(session?.model).toBe("opus");

		store.close();
	});

	test("list returns sessions ordered by last_active desc", async () => {
		const store = new SessionStore(TEST_DB);

		store.upsert({ sdkSessionId: "old", title: "Old", model: "haiku" });
		await new Promise((r) => setTimeout(r, 10));
		store.upsert({ sdkSessionId: "new", title: "New", model: "sonnet" });

		const sessions = store.list();
		expect(sessions.length).toBe(2);
		expect(sessions[0]?.sdkSessionId).toBe("new");

		store.close();
	});

	test("getActiveSessionId / setActiveSessionId", () => {
		const store = new SessionStore(TEST_DB);

		expect(store.getActiveSessionId()).toBeUndefined();

		store.setActiveSessionId("sdk-456");
		expect(store.getActiveSessionId()).toBe("sdk-456");

		store.setActiveSessionId(undefined);
		expect(store.getActiveSessionId()).toBeUndefined();

		store.close();
	});

	test("active session persists across instances", () => {
		let store = new SessionStore(TEST_DB);
		store.setActiveSessionId("sdk-789");
		store.close();

		store = new SessionStore(TEST_DB);
		expect(store.getActiveSessionId()).toBe("sdk-789");
		store.close();
	});
});
