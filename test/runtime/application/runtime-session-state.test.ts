import { describe, expect, test } from "bun:test";
import type { DoneEvent } from "../../../src/common/protocol.ts";
import { RuntimeSessionState } from "../../../src/runtime/application/runtime-session-state.ts";

const AGENT_ID = "agent-legacy";

function makeDoneEvent(
	sessionId = "sdk-abc",
	overrides?: Partial<DoneEvent>,
): DoneEvent {
	return {
		type: "done",
		sessionId,
		durationMs: 100,
		costUsd: 0.01,
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

describe("RuntimeSessionState", () => {
	test("starts with no active session", () => {
		const state = new RuntimeSessionState();
		expect(state.sessionId).toBeUndefined();
		expect(state.sessionTitle).toBeUndefined();
		expect(state.sessionSource).toBe("tui");
		expect(state.generation).toBe(0);
	});

	describe("preparePrompt", () => {
		test("derives title from text prompts", () => {
			const state = new RuntimeSessionState();
			state.preparePrompt("What is the meaning of life?");

			expect(state.sessionTitle).toBe("What is the meaning of life?");
		});

		test("derives title from image-only prompts", () => {
			const state = new RuntimeSessionState();
			state.preparePrompt("", [
				{ path: "/tmp/a.png", mediaType: "image/png" },
				{ path: "/tmp/b.jpg", mediaType: "image/jpeg" },
			]);

			expect(state.sessionTitle).toBe("2 images");
		});

		test("does not override an existing title", () => {
			const state = new RuntimeSessionState();
			state.preparePrompt("First prompt");
			state.preparePrompt("Second prompt");

			expect(state.sessionTitle).toBe("First prompt");
		});
	});

	describe("clearSession", () => {
		test("clears session state and increments generation", () => {
			const state = new RuntimeSessionState();
			state.preparePrompt("hello");
			state.completeRun(makeDoneEvent());
			const generation = state.generation;

			state.clearSession();

			expect(state.sessionId).toBeUndefined();
			expect(state.sessionTitle).toBeUndefined();
			expect(state.usage).toBeUndefined();
			expect(state.sessionSource).toBe("tui");
			expect(state.generation).toBe(generation + 1);
		});
	});

	describe("completeRun", () => {
		test("records session id, usage, and source", () => {
			const state = new RuntimeSessionState();
			const done = makeDoneEvent("sdk-xyz");

			state.completeRun(done, "tui");

			expect(state.sessionId).toBe("sdk-xyz");
			expect(state.usage).toEqual(done.usage);
			expect(state.sessionSource).toBe("tui");
		});

		test("tracks the last telegram delivery target", () => {
			const state = new RuntimeSessionState();

			state.preparePrompt("from telegram");
			state.completeRun(makeDoneEvent("sdk-tg"), "telegram", 123);

			expect(state.createHeartbeatDeliveryTarget()).toEqual({
				clientType: "telegram",
				telegramChatId: 123,
			});
		});

		test("keeps the last telegram delivery target when heartbeat completes", () => {
			const state = new RuntimeSessionState();

			state.preparePrompt("from telegram");
			state.completeRun(makeDoneEvent("sdk-tg"), "telegram", 123);
			state.completeRun(makeDoneEvent("sdk-tg"), "heartbeat");

			expect(state.createHeartbeatDeliveryTarget()).toEqual({
				clientType: "telegram",
				telegramChatId: 123,
			});
		});
	});

	describe("restorePersistedState", () => {
		test("restores the active session, usage, and heartbeat target", () => {
			const state = new RuntimeSessionState();
			const usage = makeDoneEvent().usage;

			state.restorePersistedState({
				lastTelegramChatId: 123,
				session: {
					agentId: AGENT_ID,
					providerId: "mock",
					sdkSessionId: "sdk-persist",
					title: "Stored title",
					model: "haiku",
					source: "telegram",
					tag: "chat",
					createdAt: 0,
					lastActive: 0,
				},
				usage,
			});

			expect(state.sessionId).toBe("sdk-persist");
			expect(state.sessionTitle).toBe("Stored title");
			expect(state.sessionSource).toBe("telegram");
			expect(state.usage).toEqual(usage);
			expect(state.createHeartbeatDeliveryTarget()).toEqual({
				clientType: "telegram",
				telegramChatId: 123,
			});
		});
	});

	describe("switchToSession", () => {
		test("switches to a stored session and increments generation", () => {
			const state = new RuntimeSessionState();
			const usage = makeDoneEvent().usage;
			const generation = state.generation;

			state.switchToSession(
				{
					agentId: AGENT_ID,
					providerId: "mock",
					sdkSessionId: "sdk-old",
					title: "Old chat",
					model: "sonnet",
					source: "telegram",
					tag: "chat",
					createdAt: Date.now(),
					lastActive: Date.now(),
				},
				usage,
			);

			expect(state.sessionId).toBe("sdk-old");
			expect(state.sessionTitle).toBe("Old chat");
			expect(state.sessionSource).toBe("telegram");
			expect(state.usage).toEqual(usage);
			expect(state.generation).toBe(generation + 1);
		});
	});

	test("renameSession only updates the active session title", () => {
		const state = new RuntimeSessionState();
		state.switchToSession(
			{
				agentId: AGENT_ID,
				providerId: "mock",
				sdkSessionId: "sdk-1",
				title: "Original",
				model: "sonnet",
				source: "tui",
				tag: "chat",
				createdAt: 0,
				lastActive: 0,
			},
			undefined,
		);

		state.renameSession("sdk-2", "Ignored");
		expect(state.sessionTitle).toBe("Original");

		state.renameSession("sdk-1", "Renamed");
		expect(state.sessionTitle).toBe("Renamed");
	});
});
