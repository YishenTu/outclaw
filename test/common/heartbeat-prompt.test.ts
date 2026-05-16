import { describe, expect, test } from "bun:test";
import {
	CURRENT_HEARTBEAT_PROMPT,
	INDEX_FILTERED_HEARTBEAT_PROMPTS,
	isHeartbeatNoopResult,
	isOperationalHeartbeatPrompt,
} from "../../src/common/heartbeat-prompt.ts";

describe("isOperationalHeartbeatPrompt", () => {
	test("returns true for the current heartbeat prompt", () => {
		expect(isOperationalHeartbeatPrompt(CURRENT_HEARTBEAT_PROMPT)).toBe(true);
	});

	test("returns true for every enumerated prompt (incl. legacy)", () => {
		for (const prompt of INDEX_FILTERED_HEARTBEAT_PROMPTS) {
			expect(isOperationalHeartbeatPrompt(prompt)).toBe(true);
		}
	});

	test("normalizes runs of whitespace before matching", () => {
		const padded = CURRENT_HEARTBEAT_PROMPT.replace(/ /g, "   ");
		expect(isOperationalHeartbeatPrompt(padded)).toBe(true);
	});

	test("returns false for unrelated content", () => {
		expect(isOperationalHeartbeatPrompt("hello world")).toBe(false);
		expect(isOperationalHeartbeatPrompt("")).toBe(false);
	});

	test("returns false for content that name-drops HEARTBEAT.md without matching", () => {
		expect(
			isOperationalHeartbeatPrompt("Please check HEARTBEAT.md when you can."),
		).toBe(false);
	});
});

describe("isHeartbeatNoopResult", () => {
	test("matches HEARTBEAT_OK ignoring surrounding backticks and whitespace", () => {
		expect(isHeartbeatNoopResult("HEARTBEAT_OK")).toBe(true);
		expect(isHeartbeatNoopResult("`HEARTBEAT_OK`")).toBe(true);
		expect(isHeartbeatNoopResult("  HEARTBEAT_OK  ")).toBe(true);
	});

	test("rejects other text", () => {
		expect(isHeartbeatNoopResult("OK")).toBe(false);
		expect(isHeartbeatNoopResult("HEARTBEAT_OK; also did X")).toBe(false);
	});
});
