import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SessionStore } from "../../src/runtime/db.ts";
import { SessionManager } from "../../src/runtime/session.ts";

const TEST_DB = join(import.meta.dir, ".tmp-session-test.sqlite");

describe("SessionManager", () => {
	afterEach(() => {
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
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
		const store = new SessionStore(TEST_DB);
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
		const store = new SessionStore(TEST_DB);
		store.setActiveSessionId("sdk-456");

		const session = new SessionManager(store);
		expect(session.id).toBe("sdk-456");

		store.close();
	});

	test("clear removes active from store", () => {
		const store = new SessionStore(TEST_DB);
		const session = new SessionManager(store);

		session.update("sdk-123", "sonnet");
		session.clear();

		expect(store.getActiveSessionId()).toBeUndefined();

		store.close();
	});
});
