import { describe, expect, test } from "bun:test";
import { applyAction } from "../../../../src/frontend/tui/transcript/reducer.ts";
import { mapEventToActions } from "../../../../src/frontend/tui/transcript/runtime-events.ts";
import { initialTuiState } from "../../../../src/frontend/tui/transcript/state.ts";

describe("mapEventToActions", () => {
	test("text event → append_streaming", () => {
		expect(mapEventToActions({ type: "text", text: "hello" })).toEqual([
			{ type: "append_streaming", text: "hello" },
		]);
	});

	test("thinking event → append_thinking", () => {
		expect(mapEventToActions({ type: "thinking", text: "reasoning" })).toEqual([
			{ type: "append_thinking", text: "reasoning" },
		]);
	});

	test("done event → commit_streaming", () => {
		expect(
			mapEventToActions({
				type: "done",
				sessionId: "s1",
				durationMs: 100,
			}),
		).toEqual([{ type: "commit_streaming" }]);
	});

	test("error event → push_and_stop with error role", () => {
		expect(
			mapEventToActions({ type: "error", message: "agent failed" }),
		).toEqual([{ type: "push_and_stop", role: "error", text: "agent failed" }]);
	});

	test("status event → push info", () => {
		expect(
			mapEventToActions({ type: "status", message: "Nothing to stop" }),
		).toEqual([{ type: "push", role: "info", text: "Nothing to stop" }]);
	});

	test("model_changed → push info", () => {
		expect(
			mapEventToActions({ type: "model_changed", model: "haiku" }),
		).toEqual([{ type: "push", role: "info", text: "model → haiku" }]);
	});

	test("effort_changed → push info", () => {
		expect(
			mapEventToActions({ type: "effort_changed", effort: "max" }),
		).toEqual([{ type: "push", role: "info", text: "effort → max" }]);
	});

	test("runtime_status without requested flag → noop", () => {
		const actions = mapEventToActions({
			type: "runtime_status",
			model: "opus",
			effort: "high",
			running: false,
			sessionId: "session-123",
		});
		expect(actions).toEqual([{ type: "noop" }]);
	});

	test("runtime_status with requested → push info with vertically aligned status", () => {
		const actions = mapEventToActions({
			type: "runtime_status",
			agentName: "railly",
			model: "opus",
			effort: "high",
			running: false,
			sessionId: "session-123",
			sessionTitle: "My chat",
			requested: true,
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
		expect(actions).toEqual([
			{
				type: "push",
				role: "status",
				text: [
					"Status",
					"session  My chat",
					"agent    railly",
					"model    opus",
					"effort   high",
					"context  1k/200k (1%)",
				].join("\n"),
			},
		]);
	});

	test("runtime_status with requested but without usage shows n/a", () => {
		const actions = mapEventToActions({
			type: "runtime_status",
			model: "haiku",
			effort: "low",
			running: false,
			requested: true,
		});
		expect(actions).toEqual([
			{
				type: "push",
				role: "status",
				text: [
					"Status",
					"session  none",
					"model    haiku",
					"effort   low",
					"context  n/a",
				].join("\n"),
			},
		]);
	});

	test("runtime_status includes heartbeat countdown", () => {
		const now = 1000;
		const actions = mapEventToActions({
			type: "runtime_status",
			model: "opus",
			effort: "high",
			running: false,
			sessionTitle: "My chat",
			nextHeartbeatAt: now + 30 * 60_000,
			requested: true,
		});
		const text = (actions[0] as { text: string }).text;
		const lines = text.split("\n");
		expect(lines).toContainEqual(expect.stringContaining("heartbeat"));
	});

	test("runtime_status truncates long session title", () => {
		const longTitle = "A".repeat(50);
		const actions = mapEventToActions({
			type: "runtime_status",
			model: "opus",
			effort: "high",
			running: false,
			sessionTitle: longTitle,
			requested: true,
		});
		const text = (actions[0] as { text: string }).text;
		const sessionLine = text.split("\n").find((l) => l.startsWith("session"));
		expect(sessionLine).toBe(`session  ${"A".repeat(37)}...`);
	});

	test("user_prompt from tui → noop (locally added)", () => {
		expect(
			mapEventToActions({
				type: "user_prompt",
				prompt: "hello",
				source: "tui",
			}),
		).toEqual([{ type: "noop" }]);
	});

	test("user_prompt from telegram → push user", () => {
		const actions = mapEventToActions({
			type: "user_prompt",
			prompt: "hello",
			source: "telegram",
		});
		expect(actions).toEqual([
			{ type: "push", role: "user", text: "[telegram] hello" },
		]);
	});

	test("user_prompt from telegram with images", () => {
		const actions = mapEventToActions({
			type: "user_prompt",
			prompt: "what is this?",
			images: [{ path: "/tmp/cat.png", mediaType: "image/png" }],
			source: "telegram",
		});
		expect(actions).toEqual([
			{
				type: "push",
				role: "user",
				text: "[telegram] what is this?\n[telegram] [image: /tmp/cat.png]",
			},
		]);
	});

	test("user_prompt from telegram with reply context", () => {
		const actions = mapEventToActions({
			type: "user_prompt",
			prompt: "what do you mean?",
			replyContext: { text: "the cron output" },
			source: "telegram",
		});
		expect(actions).toEqual([
			{
				type: "push",
				role: "user",
				text: "[telegram] what do you mean?",
				replyText: "the cron output",
			},
		]);
	});

	test("user_prompt from heartbeat → push heartbeat indicator", () => {
		const actions = mapEventToActions({
			type: "user_prompt",
			prompt: "check tasks",
			source: "heartbeat",
		});
		expect(actions).toEqual([
			{
				type: "push",
				role: "info",
				text: "Heartbeat",
				variant: "heartbeat",
			},
		]);
	});

	test("image event → push info", () => {
		expect(
			mapEventToActions({ type: "image", path: "/tmp/chart.png" }),
		).toEqual([{ type: "push", role: "info", text: "image: /tmp/chart.png" }]);
	});

	test("cron_result → info header + assistant body", () => {
		expect(
			mapEventToActions({
				type: "cron_result",
				jobName: "daily-summary",
				text: "All clear",
			}),
		).toEqual([
			{ type: "push", role: "info", text: "[cron] daily-summary" },
			{ type: "push", role: "assistant", text: "All clear" },
		]);
	});

	test("session_cleared → clear", () => {
		expect(mapEventToActions({ type: "session_cleared" })).toEqual([
			{ type: "clear" },
		]);
	});

	test("session_switched → clear", () => {
		expect(
			mapEventToActions({
				type: "session_switched",
				sdkSessionId: "s1",
				title: "Chat",
			}),
		).toEqual([{ type: "clear" }]);
	});

	test("history_replay → replay with converted messages", () => {
		const actions = mapEventToActions({
			type: "history_replay",
			messages: [
				{ kind: "chat", role: "assistant", content: "Hello" },
				{ kind: "chat", role: "user", content: "Question" },
			],
		});
		expect(actions).toEqual([
			{
				type: "replay",
				messages: [
					{ id: 1, role: "assistant", text: "Hello" },
					{ id: 2, role: "user", text: "Question" },
				],
			},
		]);
	});

	test("history_replay with thinking content", () => {
		const actions = mapEventToActions({
			type: "history_replay",
			messages: [
				{
					kind: "chat",
					role: "assistant",
					content: "The answer",
					thinking: "Let me reason",
				},
			],
		});
		expect(actions).toEqual([
			{
				type: "replay",
				messages: [
					{ id: 1, role: "thinking", text: "Let me reason" },
					{ id: 2, role: "assistant", text: "The answer" },
				],
			},
		]);
	});

	test("history_replay with user images", () => {
		const actions = mapEventToActions({
			type: "history_replay",
			messages: [
				{
					kind: "chat",
					role: "user",
					content: "",
					images: [{ mediaType: "image/png" }],
				},
			],
		});
		expect(actions).toEqual([
			{ type: "replay", messages: [{ id: 1, role: "user", text: "[image]" }] },
		]);
	});

	test("history_replay with user reply context", () => {
		const actions = mapEventToActions({
			type: "history_replay",
			messages: [
				{
					kind: "chat",
					role: "user",
					content: "Question",
					replyContext: { text: "Earlier answer" },
				},
			],
		});
		expect(actions).toEqual([
			{
				type: "replay",
				messages: [
					{
						id: 1,
						role: "user",
						text: "Question",
						replyText: "Earlier answer",
					},
				],
			},
		]);
	});

	test("compacting_started → start_compacting action", () => {
		const actions = mapEventToActions({ type: "compacting_started" });
		expect(actions).toEqual([{ type: "start_compacting" }]);
	});

	test("compacting_finished → finish_compacting action", () => {
		const actions = mapEventToActions({ type: "compacting_finished" });
		expect(actions).toEqual([{ type: "finish_compacting" }]);
	});

	test("start_compacting sets compacting flag", () => {
		const state = applyAction(initialTuiState(), { type: "start_compacting" });
		expect(state.compacting).toBe(true);
	});

	test("finish_compacting clears flag and pushes info message", () => {
		const compactingState = applyAction(initialTuiState(), {
			type: "start_compacting",
		});
		const state = applyAction(compactingState, { type: "finish_compacting" });
		expect(state.compacting).toBe(false);
		expect(state.messages).toHaveLength(1);
		expect(state.messages[0]?.role).toBe("info");
		expect(state.messages[0]?.text).toBe("context compacted");
		expect(state.messages[0]?.variant).toBe("compact_boundary");
	});

	test("commit_streaming clears compacting even when no text was produced", () => {
		const compactingState = applyAction(initialTuiState(), {
			type: "start_compacting",
		});
		const state = applyAction(compactingState, { type: "commit_streaming" });
		expect(state.compacting).toBe(false);
	});

	test("push_and_stop clears compacting on error", () => {
		const compactingState = applyAction(initialTuiState(), {
			type: "start_compacting",
		});
		const state = applyAction(compactingState, {
			type: "push_and_stop",
			role: "error",
			text: "failed",
		});
		expect(state.compacting).toBe(false);
	});

	test("clear resets compacting", () => {
		const compactingState = applyAction(initialTuiState(), {
			type: "start_compacting",
		});
		const state = applyAction(compactingState, { type: "clear" });
		expect(state.compacting).toBe(false);
	});

	test("replay resets compacting", () => {
		const compactingState = applyAction(initialTuiState(), {
			type: "start_compacting",
		});
		const state = applyAction(compactingState, {
			type: "replay",
			messages: [{ id: 1, role: "info", text: "history" }],
		});
		expect(state.compacting).toBe(false);
	});

	test("history_replay renders compact_boundary as info message", () => {
		const actions = mapEventToActions({
			type: "history_replay",
			messages: [
				{ kind: "chat", role: "user", content: "hello" },
				{
					kind: "system",
					event: "compact_boundary",
					text: "context compacted",
					trigger: "auto",
					preTokens: 100_000,
				},
				{ kind: "chat", role: "assistant", content: "world" },
			],
		});
		expect(actions).toEqual([
			{
				type: "replay",
				messages: [
					{ id: 1, role: "user", text: "hello" },
					{
						id: 2,
						role: "info",
						text: "context compacted",
						variant: "compact_boundary",
					},
					{ id: 3, role: "assistant", text: "world" },
				],
			},
		]);
	});

	test("history_replay keeps heartbeat indicators compact", () => {
		const actions = mapEventToActions({
			type: "history_replay",
			messages: [
				{ kind: "system", event: "heartbeat", text: "Heartbeat" },
				{ kind: "chat", role: "assistant", content: "HEARTBEAT_OK" },
			],
		});
		expect(actions).toEqual([
			{
				type: "replay",
				messages: [
					{ id: 1, role: "info", text: "Heartbeat", variant: "heartbeat" },
					{ id: 2, role: "assistant", text: "HEARTBEAT_OK" },
				],
			},
		]);
	});

	test("session_menu → session_menu action", () => {
		const actions = mapEventToActions({
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
		expect(actions).toEqual([
			{
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
			},
		]);
	});

	test("session_renamed → noop", () => {
		expect(
			mapEventToActions({
				type: "session_renamed",
				sdkSessionId: "s1",
				title: "New title",
			}),
		).toEqual([{ type: "noop" }]);
	});

	test("session_deleted → noop", () => {
		expect(
			mapEventToActions({
				type: "session_deleted",
				sdkSessionId: "s1",
			}),
		).toEqual([{ type: "noop" }]);
	});
});

describe("applyAction", () => {
	test("heartbeat rows disappear when the final heartbeat result is only HEARTBEAT_OK", () => {
		let state = initialTuiState();
		state = applyAction(state, {
			type: "push",
			role: "info",
			text: "Heartbeat",
			variant: "heartbeat",
		});
		state = applyAction(state, {
			type: "append_streaming",
			text: " `HEARTBEAT_OK` ",
		});
		state = applyAction(state, { type: "commit_streaming" });

		expect(state.messages).toEqual([]);
		expect(state.running).toBe(false);
	});

	test("heartbeat rows keep buffered output when the heartbeat produced content", () => {
		let state = initialTuiState();
		state = applyAction(state, {
			type: "push",
			role: "info",
			text: "Heartbeat",
			variant: "heartbeat",
		});
		state = applyAction(state, {
			type: "append_thinking",
			text: "checking tasks",
		});
		state = applyAction(state, {
			type: "append_streaming",
			text: "Updated inbox triage notes.",
		});
		state = applyAction(state, { type: "commit_streaming" });

		expect(state.messages).toEqual([
			{ id: 1, role: "info", text: "Heartbeat", variant: "heartbeat" },
			{ id: 2, role: "thinking", text: "checking tasks" },
			{ id: 3, role: "assistant", text: "Updated inbox triage notes." },
		]);
		expect(state.running).toBe(false);
	});

	test("heartbeat rows disappear when HEARTBEAT_OK is accompanied only by hidden thinking", () => {
		let state = initialTuiState();
		state = applyAction(state, {
			type: "push",
			role: "info",
			text: "Heartbeat",
			variant: "heartbeat",
		});
		state = applyAction(state, {
			type: "append_thinking",
			text: "checking tasks",
		});
		state = applyAction(state, {
			type: "append_streaming",
			text: "`HEARTBEAT_OK`",
		});
		state = applyAction(state, { type: "commit_streaming" });

		expect(state.messages).toEqual([]);
		expect(state.running).toBe(false);
	});

	test("append_thinking accumulates thinking text", () => {
		const state = initialTuiState();
		const next = applyAction(state, {
			type: "append_thinking",
			text: "let me think",
		});
		expect(next.streamingThinking).toBe("let me think");
		expect(next.running).toBe(true);

		const next2 = applyAction(next, {
			type: "append_thinking",
			text: " about this",
		});
		expect(next2.streamingThinking).toBe("let me think about this");
	});

	test("commit_streaming flushes thinking then text", () => {
		let state = initialTuiState();
		state = applyAction(state, {
			type: "append_thinking",
			text: "reasoning",
		});
		state = applyAction(state, {
			type: "append_streaming",
			text: "answer",
		});
		state = applyAction(state, { type: "commit_streaming" });

		expect(state.messages).toEqual([
			{ id: 1, role: "thinking", text: "reasoning" },
			{ id: 2, role: "assistant", text: "answer" },
		]);
		expect(state.streaming).toBe("");
		expect(state.streamingThinking).toBe("");
		expect(state.running).toBe(false);
	});

	test("commit_streaming with only thinking content", () => {
		let state = initialTuiState();
		state = applyAction(state, {
			type: "append_thinking",
			text: "just thinking",
		});
		state = applyAction(state, { type: "commit_streaming" });

		expect(state.messages).toEqual([
			{ id: 1, role: "thinking", text: "just thinking" },
		]);
		expect(state.streamingThinking).toBe("");
	});

	test("push_and_stop commits thinking before error", () => {
		let state = initialTuiState();
		state = applyAction(state, {
			type: "append_thinking",
			text: "reasoning",
		});
		state = applyAction(state, {
			type: "append_streaming",
			text: "partial",
		});
		state = applyAction(state, {
			type: "push_and_stop",
			role: "error",
			text: "failed",
		});
		expect(state.messages).toEqual([
			{ id: 1, role: "thinking", text: "reasoning" },
			{ id: 2, role: "assistant", text: "partial" },
			{ id: 3, role: "error", text: "failed" },
		]);
		expect(state.streamingThinking).toBe("");
	});

	test("clear resets streamingThinking", () => {
		let state = initialTuiState();
		state = applyAction(state, {
			type: "append_thinking",
			text: "thinking",
		});
		state = applyAction(state, { type: "clear" });
		expect(state.streamingThinking).toBe("");
	});

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

	test("push preserves user reply text", () => {
		const state = initialTuiState();
		const next = applyAction(state, {
			type: "push",
			role: "user",
			text: "Question",
			replyText: "Earlier answer",
		});
		expect(next.messages).toEqual([
			{
				id: 1,
				role: "user",
				text: "Question",
				replyText: "Earlier answer",
			},
		]);
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
