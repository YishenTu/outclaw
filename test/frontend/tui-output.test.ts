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
});
