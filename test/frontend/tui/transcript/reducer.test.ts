import { describe, expect, test } from "bun:test";
import { applyAction } from "../../../../src/frontend/tui/transcript/reducer.ts";
import { mapEventToAction } from "../../../../src/frontend/tui/transcript/runtime-events.ts";
import { initialTuiState } from "../../../../src/frontend/tui/transcript/state.ts";

describe("mapEventToAction", () => {
	test("text event → append_streaming", () => {
		expect(mapEventToAction({ type: "text", text: "hello" })).toEqual({
			type: "append_streaming",
			text: "hello",
		});
	});

	test("done event → commit_streaming", () => {
		expect(
			mapEventToAction({
				type: "done",
				sessionId: "s1",
				durationMs: 100,
			}),
		).toEqual({ type: "commit_streaming" });
	});

	test("error event → push_and_stop with error role", () => {
		expect(
			mapEventToAction({ type: "error", message: "agent failed" }),
		).toEqual({
			type: "push_and_stop",
			role: "error",
			text: "agent failed",
		});
	});

	test("status event → push info", () => {
		expect(
			mapEventToAction({ type: "status", message: "Nothing to stop" }),
		).toEqual({ type: "push", role: "info", text: "Nothing to stop" });
	});

	test("model_changed → push info", () => {
		expect(mapEventToAction({ type: "model_changed", model: "haiku" })).toEqual(
			{ type: "push", role: "info", text: "model → haiku" },
		);
	});

	test("effort_changed → push info", () => {
		expect(mapEventToAction({ type: "effort_changed", effort: "max" })).toEqual(
			{ type: "push", role: "info", text: "effort → max" },
		);
	});

	test("runtime_status → push info with formatted context", () => {
		const action = mapEventToAction({
			type: "runtime_status",
			model: "opus",
			effort: "high",
			sessionId: "session-123",
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				cacheCreationTokens: 0,
				cacheReadTokens: 0,
				contextWindow: 200000,
				maxOutputTokens: 32000,
				contextTokens: 1234,
				percentage: 1,
			},
		});
		expect(action).toEqual({
			type: "push",
			role: "info",
			text: "model=opus effort=high session=session-123 context=1,234/200,000 tokens (1%)",
		});
	});

	test("runtime_status without usage shows n/a", () => {
		const action = mapEventToAction({
			type: "runtime_status",
			model: "haiku",
			effort: "low",
		});
		expect(action).toEqual({
			type: "push",
			role: "info",
			text: "model=haiku effort=low session=none context=n/a",
		});
	});

	test("user_prompt from tui → noop (locally added)", () => {
		expect(
			mapEventToAction({
				type: "user_prompt",
				prompt: "hello",
				source: "tui",
			}),
		).toEqual({ type: "noop" });
	});

	test("user_prompt from telegram → push user", () => {
		const action = mapEventToAction({
			type: "user_prompt",
			prompt: "hello",
			source: "telegram",
		});
		expect(action).toEqual({
			type: "push",
			role: "user",
			text: "[telegram] hello",
		});
	});

	test("user_prompt from telegram with images", () => {
		const action = mapEventToAction({
			type: "user_prompt",
			prompt: "what is this?",
			images: [{ path: "/tmp/cat.png", mediaType: "image/png" }],
			source: "telegram",
		});
		expect(action).toEqual({
			type: "push",
			role: "user",
			text: "[telegram] what is this?\n[telegram] [image: /tmp/cat.png]",
		});
	});

	test("image event → push info", () => {
		expect(mapEventToAction({ type: "image", path: "/tmp/chart.png" })).toEqual(
			{
				type: "push",
				role: "info",
				text: "image: /tmp/chart.png",
			},
		);
	});

	test("cron_result → push info", () => {
		expect(
			mapEventToAction({
				type: "cron_result",
				jobName: "daily-summary",
				text: "All clear",
			}),
		).toEqual({
			type: "push",
			role: "info",
			text: "[cron] daily-summary\nAll clear",
		});
	});

	test("session_cleared → clear", () => {
		expect(mapEventToAction({ type: "session_cleared" })).toEqual({
			type: "clear",
		});
	});

	test("session_switched → clear", () => {
		expect(
			mapEventToAction({
				type: "session_switched",
				sdkSessionId: "s1",
				title: "Chat",
			}),
		).toEqual({ type: "clear" });
	});

	test("history_replay → replay with converted messages", () => {
		const action = mapEventToAction({
			type: "history_replay",
			messages: [
				{ role: "assistant", content: "Hello" },
				{ role: "user", content: "Question" },
			],
		});
		expect(action).toEqual({
			type: "replay",
			messages: [
				{ id: 1, role: "assistant", text: "Hello" },
				{ id: 2, role: "user", text: "Question" },
			],
		});
	});

	test("history_replay with user images", () => {
		const action = mapEventToAction({
			type: "history_replay",
			messages: [
				{
					role: "user",
					content: "",
					images: [{ mediaType: "image/png" }],
				},
			],
		});
		expect(action).toEqual({
			type: "replay",
			messages: [{ id: 1, role: "user", text: "[image]" }],
		});
	});

	test("session_menu → session_menu action", () => {
		const action = mapEventToAction({
			type: "session_menu",
			activeSessionId: "sdk-abc",
			sessions: [
				{
					sdkSessionId: "sdk-abc",
					title: "Chat A",
					model: "opus",
					lastActive: 1000,
				},
			],
		});
		expect(action).toEqual({
			type: "session_menu",
			data: {
				activeSessionId: "sdk-abc",
				sessions: [
					{
						sdkSessionId: "sdk-abc",
						title: "Chat A",
						model: "opus",
						lastActive: 1000,
					},
				],
			},
		});
	});

	test("session_renamed → noop", () => {
		expect(
			mapEventToAction({
				type: "session_renamed",
				sdkSessionId: "s1",
				title: "New title",
			}),
		).toEqual({ type: "noop" });
	});

	test("session_deleted → noop", () => {
		expect(
			mapEventToAction({
				type: "session_deleted",
				sdkSessionId: "s1",
			}),
		).toEqual({ type: "noop" });
	});
});

describe("applyAction", () => {
	test("append_streaming accumulates text", () => {
		const state = initialTuiState();
		const next = applyAction(state, {
			type: "append_streaming",
			text: "hello",
		});
		expect(next.streaming).toBe("hello");
		expect(next.running).toBe(true);

		const next2 = applyAction(next, {
			type: "append_streaming",
			text: " world",
		});
		expect(next2.streaming).toBe("hello world");
	});

	test("commit_streaming flushes buffer to messages", () => {
		let state = initialTuiState();
		state = applyAction(state, {
			type: "append_streaming",
			text: "response",
		});
		state = applyAction(state, { type: "commit_streaming" });

		expect(state.messages).toEqual([
			{ id: 1, role: "assistant", text: "response" },
		]);
		expect(state.streaming).toBe("");
		expect(state.running).toBe(false);
	});

	test("commit_streaming with empty buffer is a no-op for messages", () => {
		const state = initialTuiState();
		const next = applyAction(state, { type: "commit_streaming" });
		expect(next.messages).toEqual([]);
		expect(next.running).toBe(false);
	});

	test("push adds a message", () => {
		const state = initialTuiState();
		const next = applyAction(state, {
			type: "push",
			role: "info",
			text: "status update",
		});
		expect(next.messages).toEqual([
			{ id: 1, role: "info", text: "status update" },
		]);
		expect(next.nextId).toBe(2);
	});

	test("push_and_stop adds message and stops running", () => {
		let state = initialTuiState();
		state = applyAction(state, {
			type: "append_streaming",
			text: "partial",
		});
		state = applyAction(state, {
			type: "push_and_stop",
			role: "error",
			text: "failed",
		});
		// streaming buffer should be committed first, then error pushed
		expect(state.messages).toEqual([
			{ id: 1, role: "assistant", text: "partial" },
			{ id: 2, role: "error", text: "failed" },
		]);
		expect(state.streaming).toBe("");
		expect(state.running).toBe(false);
	});

	test("push_and_stop with empty streaming just pushes error", () => {
		const state = initialTuiState();
		const next = applyAction(state, {
			type: "push_and_stop",
			role: "error",
			text: "failed",
		});
		expect(next.messages).toEqual([{ id: 1, role: "error", text: "failed" }]);
	});

	test("clear resets messages and streaming", () => {
		let state = initialTuiState();
		state = applyAction(state, {
			type: "push",
			role: "user",
			text: "hello",
		});
		state = applyAction(state, { type: "clear" });
		expect(state.messages).toEqual([]);
		expect(state.streaming).toBe("");
		expect(state.running).toBe(false);
	});

	test("replay replaces all messages", () => {
		let state = initialTuiState();
		state = applyAction(state, {
			type: "push",
			role: "user",
			text: "old",
		});
		state = applyAction(state, {
			type: "replay",
			messages: [
				{ id: 1, role: "assistant", text: "replayed" },
				{ id: 2, role: "user", text: "question" },
			],
		});
		expect(state.messages).toEqual([
			{ id: 1, role: "assistant", text: "replayed" },
			{ id: 2, role: "user", text: "question" },
		]);
		expect(state.nextId).toBe(3);
	});

	test("noop returns same state", () => {
		const state = initialTuiState();
		const next = applyAction(state, { type: "noop" });
		expect(next).toBe(state);
	});

	test("session_menu returns same state (handled externally)", () => {
		const state = initialTuiState();
		const next = applyAction(state, {
			type: "session_menu",
			data: { sessions: [] },
		});
		expect(next).toBe(state);
	});

	test("ids increment across multiple pushes", () => {
		let state = initialTuiState();
		state = applyAction(state, {
			type: "push",
			role: "user",
			text: "a",
		});
		state = applyAction(state, {
			type: "push",
			role: "info",
			text: "b",
		});
		state = applyAction(state, {
			type: "append_streaming",
			text: "c",
		});
		state = applyAction(state, { type: "commit_streaming" });
		expect(state.messages.map((m) => m.id)).toEqual([1, 2, 3]);
	});
});
