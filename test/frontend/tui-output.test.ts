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
});
