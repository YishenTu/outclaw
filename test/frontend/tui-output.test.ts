import { describe, expect, test } from "bun:test";
import { getTuiEventUpdate } from "../../src/frontend/tui/output.ts";

describe("TUI event output", () => {
	test("renders informational status events", () => {
		const update = getTuiEventUpdate({
			type: "status",
			message: "Nothing to stop",
		});

		expect(update).toEqual({
			append: "[status] Nothing to stop\n",
		});
	});

	test("preserves runtime status formatting", () => {
		const update = getTuiEventUpdate({
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

		expect(update).toEqual({
			append:
				"[status] model=opus effort=high session=session-123 context=1,234/200,000 tokens (1%)\n",
		});
	});

	test("renders live image prompts", () => {
		const update = getTuiEventUpdate({
			type: "user_prompt",
			prompt: "what is this?",
			images: [{ path: "/tmp/cat.png", mediaType: "image/png" }],
			source: "telegram",
		});

		expect(update).toEqual({
			append: "[telegram] what is this?\n[telegram] [image: /tmp/cat.png]\n",
		});
	});

	test("renders outbound image events", () => {
		const update = getTuiEventUpdate({
			type: "image",
			path: "/tmp/chart.png",
		});

		expect(update).toEqual({
			append: "[image: /tmp/chart.png]\n",
		});
	});

	test("renders cron results", () => {
		const update = getTuiEventUpdate({
			type: "cron_result",
			jobName: "daily-summary",
			text: "All clear",
		});

		expect(update).toEqual({
			append: "[cron] daily-summary\nAll clear\n",
		});
	});

	test("renders replayed image prompts without a path", () => {
		const update = getTuiEventUpdate({
			type: "history_replay",
			messages: [
				{
					role: "user",
					content: "",
					images: [{ mediaType: "image/png" }],
				},
			],
		});

		expect(update).toEqual({
			replace: "> [image]\n",
		});
	});

	test("clears the screen for session reset events", () => {
		expect(getTuiEventUpdate({ type: "session_cleared" })).toEqual({
			replace: "",
		});
		expect(
			getTuiEventUpdate({
				type: "session_switched",
				sdkSessionId: "sdk-session-123",
				title: "Recovered chat",
			}),
		).toEqual({
			replace: "",
		});
	});

	test("renders model and effort changes", () => {
		expect(
			getTuiEventUpdate({
				type: "model_changed",
				model: "haiku",
			}),
		).toEqual({
			append: "[model] haiku\n",
		});
		expect(
			getTuiEventUpdate({
				type: "effort_changed",
				effort: "max",
			}),
		).toEqual({
			append: "[effort] max\n",
		});
	});

	test("renders runtime status without usage as n/a", () => {
		const update = getTuiEventUpdate({
			type: "runtime_status",
			model: "haiku",
			effort: "low",
		});

		expect(update).toEqual({
			append: "[status] model=haiku effort=low session=none context=n/a\n",
		});
	});

	test("renders plain text, done, and error events", () => {
		expect(
			getTuiEventUpdate({
				type: "text",
				text: "partial output",
			}),
		).toEqual({
			append: "partial output",
		});
		expect(
			getTuiEventUpdate({
				type: "done",
				sessionId: "sdk-session-123",
				durationMs: 1,
			}),
		).toEqual({
			append: "\n",
			running: false,
		});
		expect(
			getTuiEventUpdate({
				type: "error",
				message: "agent failed",
			}),
		).toEqual({
			append: "\n[error] agent failed",
			running: false,
		});
	});

	test("renders replay history for assistant messages and user text", () => {
		const update = getTuiEventUpdate({
			type: "history_replay",
			messages: [
				{
					role: "assistant",
					content: "Assistant reply",
				},
				{
					role: "user",
					content: "Question",
					images: [{ path: "/tmp/cat.png", mediaType: "image/png" }],
				},
			],
		});

		expect(update).toEqual({
			replace: "Assistant reply\n\n> Question\n> [image: /tmp/cat.png]\n",
		});
	});

	test("renders image-only live prompts as image lines", () => {
		const update = getTuiEventUpdate({
			type: "user_prompt",
			prompt: "",
			images: [{ mediaType: "image/png" }],
			source: "telegram",
		});

		expect(update).toEqual({
			append: "[telegram] [image]\n",
		});
	});
});
