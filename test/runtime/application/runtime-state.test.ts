import { describe, expect, test } from "bun:test";
import { DEFAULT_EFFORT, DEFAULT_MODEL } from "../../../src/common/commands.ts";
import { MODELS } from "../../../src/common/models.ts";
import type { DoneEvent } from "../../../src/common/protocol.ts";
import { RuntimeState } from "../../../src/runtime/application/runtime-state.ts";

const PROVIDER_ID = "mock";

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

describe("RuntimeState", () => {
	test("starts with default model and effort", () => {
		const state = new RuntimeState(PROVIDER_ID);
		expect(state.model).toBe(DEFAULT_MODEL);
		expect(state.effort).toBe(DEFAULT_EFFORT);
	});

	test("resolvedModel returns the SDK model ID", () => {
		const state = new RuntimeState(PROVIDER_ID);
		expect(state.resolvedModel).toBe(MODELS[DEFAULT_MODEL].id);
	});

	test("starts with no session", () => {
		const state = new RuntimeState(PROVIDER_ID);
		expect(state.sessionId).toBeUndefined();
		expect(state.sessionTitle).toBeUndefined();
	});

	test("setModel changes model", () => {
		const state = new RuntimeState(PROVIDER_ID);
		state.setModel("haiku");
		expect(state.model).toBe("haiku");
		expect(state.resolvedModel).toBe(MODELS.haiku.id);
	});

	test("setEffort changes effort", () => {
		const state = new RuntimeState(PROVIDER_ID);
		state.setEffort("low");
		expect(state.effort).toBe("low");
	});

	describe("preparePrompt", () => {
		test("derives title from text prompt", () => {
			const state = new RuntimeState(PROVIDER_ID);
			state.preparePrompt("What is the meaning of life?");
			expect(state.sessionTitle).toBe("What is the meaning of life?");
		});

		test("truncates long titles to 100 chars", () => {
			const state = new RuntimeState(PROVIDER_ID);
			const longPrompt = "a".repeat(200);
			state.preparePrompt(longPrompt);
			expect(state.sessionTitle).toBe("a".repeat(100));
		});

		test("derives title from single image prompt", () => {
			const state = new RuntimeState(PROVIDER_ID);
			state.preparePrompt("", [
				{ path: "/tmp/cat.png", mediaType: "image/png" },
			]);
			expect(state.sessionTitle).toBe("Image");
		});

		test("derives title from multiple images prompt", () => {
			const state = new RuntimeState(PROVIDER_ID);
			state.preparePrompt("", [
				{ path: "/tmp/a.png", mediaType: "image/png" },
				{ path: "/tmp/b.jpg", mediaType: "image/jpeg" },
			]);
			expect(state.sessionTitle).toBe("2 images");
		});

		test("does not override title once session is established", () => {
			const state = new RuntimeState(PROVIDER_ID);
			state.preparePrompt("First prompt");
			state.completeRun(makeDoneEvent());
			state.preparePrompt("Second prompt");
			expect(state.sessionTitle).toBe("First prompt");
		});

		test("returns undefined title for empty prompt with no images", () => {
			const state = new RuntimeState(PROVIDER_ID);
			state.preparePrompt("");
			expect(state.sessionTitle).toBeUndefined();
		});
	});

	describe("clearSession", () => {
		test("clears session and increments generation", () => {
			const state = new RuntimeState(PROVIDER_ID);
			const gen0 = state.generation;
			state.preparePrompt("hello");
			state.completeRun(makeDoneEvent());

			state.clearSession();
			expect(state.sessionId).toBeUndefined();
			expect(state.generation).toBe(gen0 + 1);
		});
	});

	describe("completeRun", () => {
		test("records session ID and usage", () => {
			const state = new RuntimeState(PROVIDER_ID);
			const done = makeDoneEvent("sdk-xyz");
			state.completeRun(done);
			expect(state.sessionId).toBe("sdk-xyz");

			const status = state.createStatusEvent();
			expect(status.usage).toEqual(done.usage);
		});

		test("tracks the last telegram delivery target", () => {
			const state = new RuntimeState(PROVIDER_ID);

			state.preparePrompt("from telegram");
			state.completeRun(makeDoneEvent("sdk-tg"), "telegram", 123);

			expect(state.createHeartbeatDeliveryTarget()).toEqual({
				clientType: "telegram",
				telegramChatId: 123,
			});
		});

		test("keeps the last user delivery target when heartbeat completes", () => {
			const state = new RuntimeState(PROVIDER_ID);

			state.preparePrompt("from telegram");
			state.completeRun(makeDoneEvent("sdk-tg"), "telegram", 123);
			state.completeRun(makeDoneEvent("sdk-tg"), "heartbeat");

			expect(state.createHeartbeatDeliveryTarget()).toEqual({
				clientType: "telegram",
				telegramChatId: 123,
			});
		});
	});

	describe("switchToSession", () => {
		test("switches to a stored session and updates model", () => {
			const state = new RuntimeState(PROVIDER_ID);
			state.switchToSession({
				providerId: PROVIDER_ID,
				sdkSessionId: "sdk-old",
				title: "Old chat",
				model: "sonnet",
				source: "tui",
				tag: "chat",
				createdAt: Date.now(),
				lastActive: Date.now(),
			});

			expect(state.sessionId).toBe("sdk-old");
			expect(state.sessionTitle).toBe("Old chat");
			expect(state.model).toBe("sonnet");
		});

		test("increments generation", () => {
			const state = new RuntimeState(PROVIDER_ID);
			const gen0 = state.generation;
			state.switchToSession({
				providerId: PROVIDER_ID,
				sdkSessionId: "sdk-1",
				title: "t",
				model: "haiku",
				source: "tui",
				tag: "chat",
				createdAt: 0,
				lastActive: 0,
			});
			expect(state.generation).toBe(gen0 + 1);
		});

		test("ignores unknown model alias in stored session", () => {
			const state = new RuntimeState(PROVIDER_ID);
			state.switchToSession({
				providerId: PROVIDER_ID,
				sdkSessionId: "sdk-1",
				title: "t",
				model: "unknown-model",
				source: "tui",
				tag: "chat",
				createdAt: 0,
				lastActive: 0,
			});
			expect(state.model).toBe(DEFAULT_MODEL);
		});
	});

	describe("createStatusEvent", () => {
		test("returns current state as a RuntimeStatusEvent", () => {
			const state = new RuntimeState(PROVIDER_ID);
			state.setModel("haiku");
			state.setEffort("max");
			state.completeRun(makeDoneEvent("sdk-status"));

			const event = state.createStatusEvent();
			expect(event.type).toBe("runtime_status");
			expect(event.model).toBe("haiku");
			expect(event.effort).toBe("max");
			expect(event.sessionId).toBe("sdk-status");
			expect(event.usage).toBeDefined();
		});

		test("includes sessionTitle when session has a title", () => {
			const state = new RuntimeState(PROVIDER_ID);
			state.preparePrompt("Hello world");
			state.completeRun(makeDoneEvent("sdk-titled"));

			const event = state.createStatusEvent();
			expect(event.sessionTitle).toBe("Hello world");
		});
	});

	describe("restorePersistedState", () => {
		test("restores the active session, usage, and heartbeat target", () => {
			const state = new RuntimeState(PROVIDER_ID);

			state.restorePersistedState({
				lastTelegramChatId: 123,
				session: {
					providerId: PROVIDER_ID,
					sdkSessionId: "sdk-persist",
					title: "Stored title",
					model: "haiku",
					source: "telegram",
					tag: "chat",
					createdAt: 0,
					lastActive: 0,
				},
				usage: makeDoneEvent().usage,
			});

			expect(state.sessionId).toBe("sdk-persist");
			expect(state.sessionTitle).toBe("Stored title");
			expect(state.model).toBe("haiku");
			expect(state.createStatusEvent().usage).toEqual(makeDoneEvent().usage);
			expect(state.createHeartbeatDeliveryTarget()).toEqual({
				clientType: "telegram",
				telegramChatId: 123,
			});
		});
	});
});
