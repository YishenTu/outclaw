import { describe, expect, test } from "bun:test";
import { SessionManager } from "../../src/runtime/session.ts";

describe("SessionManager", () => {
	test("starts with no active session", () => {
		const session = new SessionManager();
		expect(session.id).toBeUndefined();
	});

	test("tracks session after update", () => {
		const session = new SessionManager();
		session.update("session-abc");
		expect(session.id).toBe("session-abc");
	});

	test("clears session", () => {
		const session = new SessionManager();
		session.update("session-abc");
		session.clear();
		expect(session.id).toBeUndefined();
	});

	test("overwrites previous session on update", () => {
		const session = new SessionManager();
		session.update("session-1");
		session.update("session-2");
		expect(session.id).toBe("session-2");
	});
});
