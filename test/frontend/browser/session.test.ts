import { describe, expect, test } from "bun:test";
import {
	createBrowserSessionRef,
	resolveBrowserSessionKey,
} from "../../../src/frontend/browser/session.ts";

describe("resolveBrowserSessionKey", () => {
	test("uses the active session key when a session is selected", () => {
		expect(
			resolveBrowserSessionKey({
				agentId: "agent-railly",
				activeSession: createBrowserSessionRef(
					"agent-railly",
					"claude",
					"sdk-123",
				),
				providerId: "mock",
			}),
		).toBe("agent-railly:claude:sdk-123");
	});

	test("uses the runtime provider for pending sessions", () => {
		expect(
			resolveBrowserSessionKey({
				agentId: "agent-railly",
				activeSession: null,
				providerId: "claude",
			}),
		).toBe("agent-railly:claude:__pending__");
	});

	test("falls back to the placeholder provider when runtime provider is unknown", () => {
		expect(
			resolveBrowserSessionKey({
				agentId: "agent-railly",
				activeSession: null,
				providerId: null,
			}),
		).toBe("agent-railly:runtime:__pending__");
	});
});
