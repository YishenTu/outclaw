import { describe, expect, test } from "bun:test";
import {
	assistantTextSegment,
	assistantThinkingSegment,
	isAssistantActionBoundaryEvent,
	startsNewAssistantMessageSegment,
} from "../../src/common/assistant-message-segments.ts";

describe("assistant message segments", () => {
	test("text deltas continue text segments", () => {
		expect(
			startsNewAssistantMessageSegment(
				assistantTextSegment("hello"),
				assistantTextSegment(" world"),
			),
		).toBe(false);
	});

	test("thinking deltas continue only when the provider block id is unchanged", () => {
		expect(
			startsNewAssistantMessageSegment(
				assistantThinkingSegment("inspect", "reasoning-1:summary:0"),
				assistantThinkingSegment(" files", "reasoning-1:summary:0"),
			),
		).toBe(false);
		expect(
			startsNewAssistantMessageSegment(
				assistantThinkingSegment("inspect", "reasoning-1:summary:0"),
				assistantThinkingSegment("run tests", "reasoning-1:summary:1"),
			),
		).toBe(true);
	});

	test("text and thinking always start separate ordered display segments", () => {
		expect(
			startsNewAssistantMessageSegment(
				assistantThinkingSegment("inspect"),
				assistantTextSegment("done"),
			),
		).toBe(true);
		expect(
			startsNewAssistantMessageSegment(
				assistantTextSegment("done"),
				assistantThinkingSegment("verify"),
			),
		).toBe(true);
	});

	test("empty deltas do not start visible segments", () => {
		expect(
			startsNewAssistantMessageSegment(
				assistantTextSegment("done"),
				assistantThinkingSegment(""),
			),
		).toBe(false);
	});

	test("provider tool events split assistant output groups", () => {
		expect(
			isAssistantActionBoundaryEvent({ type: "command_execution_started" }),
		).toBe(true);
		expect(
			isAssistantActionBoundaryEvent({ type: "tool_call_completed" }),
		).toBe(true);
		expect(isAssistantActionBoundaryEvent({ type: "thinking" })).toBe(false);
		expect(isAssistantActionBoundaryEvent({ type: "text" })).toBe(false);
	});
});
