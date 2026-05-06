import { describe, expect, test } from "bun:test";
import {
	createBrowserSessionRef,
	resolveBrowserSessionKey,
	resolveComposerSessionKey,
	resolveCurrentBrowserSessionKey,
	resolveDisplayedAgentSessionKey,
	resolveDisplayedSessionTitle,
} from "../../../src/frontend/browser/sessions/session.ts";

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

describe("resolveCurrentBrowserSessionKey", () => {
	test("prefers the runtime session when sidebar state is stale", () => {
		expect(
			resolveCurrentBrowserSessionKey({
				agentId: "agent-railly",
				activeSession: createBrowserSessionRef(
					"agent-railly",
					"claude",
					"sdk-stale",
				),
				providerId: "claude",
				runtimeSessionId: "sdk-live",
			}),
		).toBe("agent-railly:claude:sdk-live");
	});

	test("falls back to the selected sidebar session when runtime has no session yet", () => {
		expect(
			resolveCurrentBrowserSessionKey({
				agentId: "agent-railly",
				activeSession: createBrowserSessionRef(
					"agent-railly",
					"claude",
					"sdk-123",
				),
				providerId: "claude",
				runtimeSessionId: null,
			}),
		).toBe("agent-railly:claude:sdk-123");
	});

	test("uses a pending session key when neither runtime nor sidebar has a session", () => {
		expect(
			resolveCurrentBrowserSessionKey({
				agentId: "agent-railly",
				activeSession: null,
				providerId: "claude",
				runtimeSessionId: null,
			}),
		).toBe("agent-railly:claude:__pending__");
	});
});

describe("resolveComposerSessionKey", () => {
	test("matches the chat panel by preferring the live runtime session", () => {
		expect(
			resolveComposerSessionKey({
				agentId: "agent-railly",
				activeSession: createBrowserSessionRef(
					"agent-railly",
					"claude",
					"sdk-stale",
				),
				providerId: "claude",
				runtimeSessionId: "sdk-live",
			}),
		).toBe("agent-railly:claude:sdk-live");
	});

	test("falls back to the selected sidebar session when the runtime is idle", () => {
		expect(
			resolveComposerSessionKey({
				agentId: "agent-railly",
				activeSession: createBrowserSessionRef(
					"agent-railly",
					"claude",
					"sdk-123",
				),
				providerId: "claude",
				runtimeSessionId: null,
			}),
		).toBe("agent-railly:claude:sdk-123");
	});

	test("can ignore the runtime session when the selected agent is not the live runtime agent", () => {
		expect(
			resolveComposerSessionKey({
				agentId: "agent-mimi",
				activeSession: createBrowserSessionRef(
					"agent-mimi",
					"claude",
					"sdk-123",
				),
				preferRuntimeSession: false,
				providerId: "claude",
				runtimeSessionId: "sdk-live-other-agent",
			}),
		).toBe("agent-mimi:claude:sdk-123");
	});
});

describe("resolveDisplayedAgentSessionKey", () => {
	test("uses the runtime session for the agent currently running in the runtime", () => {
		expect(
			resolveDisplayedAgentSessionKey({
				agentId: "agent-railly",
				agentName: "railly",
				activeSession: createBrowserSessionRef(
					"agent-railly",
					"claude",
					"sdk-stale",
				),
				providerId: "claude",
				runtimeAgentName: "railly",
				runtimeSessionId: "sdk-live",
			}),
		).toBe("agent-railly:claude:sdk-live");
	});

	test("uses the selected agent session when another agent is running", () => {
		expect(
			resolveDisplayedAgentSessionKey({
				agentId: "agent-mimi",
				agentName: "mimi",
				activeSession: createBrowserSessionRef(
					"agent-mimi",
					"claude",
					"sdk-mimi",
				),
				providerId: "claude",
				runtimeAgentName: "railly",
				runtimeSessionId: "sdk-railly",
			}),
		).toBe("agent-mimi:claude:sdk-mimi");
	});
});

describe("resolveDisplayedSessionTitle", () => {
	test("uses New conversation for the active runtime session while its title is pending", () => {
		expect(
			resolveDisplayedSessionTitle({
				activeSession: createBrowserSessionRef(
					"agent-railly",
					"claude",
					"sdk-live",
				),
				agentName: "railly",
				providerId: "claude",
				runtimeAgentName: "railly",
				runtimeSessionId: "sdk-live",
				sessionTitleFromRuntime: null,
			}),
		).toBe("New conversation");
	});

	test("keeps persisted titles and falls back to ids only for non-runtime sessions", () => {
		expect(
			resolveDisplayedSessionTitle({
				activeSession: createBrowserSessionRef(
					"agent-railly",
					"claude",
					"sdk-live",
				),
				activeSessionTitle: "Generated title",
				agentName: "railly",
				providerId: "claude",
				runtimeAgentName: "railly",
				runtimeSessionId: "sdk-live",
			}),
		).toBe("Generated title");

		expect(
			resolveDisplayedSessionTitle({
				activeSession: createBrowserSessionRef(
					"agent-mimi",
					"claude",
					"sdk-mimi",
				),
				agentName: "mimi",
				providerId: "claude",
				runtimeAgentName: "railly",
				runtimeSessionId: "sdk-railly",
			}),
		).toBe("sdk-mimi");
	});

	test("ignores runtime titles from another displayed agent", () => {
		expect(
			resolveDisplayedSessionTitle({
				activeSession: createBrowserSessionRef(
					"agent-mimi",
					"claude",
					"sdk-mimi",
				),
				activeSessionTitle: "Mimi active",
				agentName: "mimi",
				providerId: "claude",
				runtimeAgentName: "railly",
				runtimeSessionId: "sdk-railly",
				sessionTitleFromRuntime: "Railly live title",
			}),
		).toBe("Mimi active");
	});
});
