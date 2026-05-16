import { describe, expect, test } from "bun:test";
import {
	CLAUDE_MODEL_ALIASES,
	CLAUDE_MODELS,
	claudeContextWindowForModel,
	claudeEffortLevelsForModel,
	describeClaudeModel,
	resolveClaudeModelForSdk,
} from "../../../src/backend/adapters/claude/models.ts";

describe("Claude model catalog", () => {
	test("resolves Claude aliases to SDK model ids inside the adapter", () => {
		expect(resolveClaudeModelForSdk("opus")).toBe(CLAUDE_MODELS.opus.id);
		expect(resolveClaudeModelForSdk("sonnet")).toBe(CLAUDE_MODELS.sonnet.id);
		expect(resolveClaudeModelForSdk("gpt-5.5")).toBe("gpt-5.5");
	});

	test("describes aliases with effort and context metadata", () => {
		expect(CLAUDE_MODEL_ALIASES).toEqual(["opus", "sonnet", "haiku"]);
		expect(describeClaudeModel("opus")).toMatchObject({
			id: CLAUDE_MODELS.opus.id,
			model: "opus",
			contextWindow: 1_000_000,
			supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
		});
		expect(describeClaudeModel("sonnet").supportedReasoningEfforts).toEqual([
			"low",
			"medium",
			"high",
			"max",
		]);
	});

	test("looks up context windows by alias or SDK id", () => {
		expect(claudeContextWindowForModel("opus")).toBe(1_000_000);
		expect(claudeContextWindowForModel(CLAUDE_MODELS.opus.id)).toBe(1_000_000);
		expect(claudeContextWindowForModel("unknown-model")).toBeUndefined();
	});

	test("keeps xhigh on Opus only", () => {
		expect(claudeEffortLevelsForModel("opus")).toContain("xhigh");
		expect(claudeEffortLevelsForModel("haiku")).not.toContain("xhigh");
	});
});
