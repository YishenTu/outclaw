import { describe, expect, test } from "bun:test";
import {
	appendThinkingBlockDelta,
	createThinkingBlockState,
	distinctThinkingBlocks,
	effectiveThinkingBlocks,
	startsNewThinkingBlock,
	ThinkingBlockAccumulator,
} from "../../src/common/thinking-blocks.ts";

describe("thinking block helpers", () => {
	test("coalesces contiguous thinking deltas without provider block ids", () => {
		let state = createThinkingBlockState();
		state = appendThinkingBlockDelta(state, { text: "let me " });
		state = appendThinkingBlockDelta(state, { text: "reason" });

		expect(state.text).toBe("let me reason");
		expect(state.blocks).toEqual(["let me reason"]);
	});

	test("preserves provider block boundaries while merging same-block deltas", () => {
		let state = createThinkingBlockState();
		state = appendThinkingBlockDelta(state, {
			text: "inspect",
			blockId: "reasoning-1:summary:0",
		});
		state = appendThinkingBlockDelta(state, {
			text: " files",
			blockId: "reasoning-1:summary:0",
		});
		state = appendThinkingBlockDelta(state, {
			text: "run tests",
			blockId: "reasoning-1:summary:1",
		});

		expect(state.text).toBe("inspect filesrun tests");
		expect(state.blocks).toEqual(["inspect files", "run tests"]);
		expect(state.currentBlockId).toBe("reasoning-1:summary:1");
	});

	test("detects when a live delta starts a new block", () => {
		const state = appendThinkingBlockDelta(createThinkingBlockState(), {
			text: "inspect",
			blockId: "reasoning-1:summary:0",
		});

		expect(
			startsNewThinkingBlock(state, {
				text: " files",
				blockId: "reasoning-1:summary:0",
			}),
		).toBe(false);
		expect(
			startsNewThinkingBlock(state, {
				text: "run tests",
				blockId: "reasoning-1:summary:1",
			}),
		).toBe(true);
	});

	test("derives display blocks from explicit blocks or plain thinking text", () => {
		expect(
			effectiveThinkingBlocks({
				text: "inspect filesrun tests",
				blocks: ["inspect files", "run tests"],
			}),
		).toEqual(["inspect files", "run tests"]);
		expect(effectiveThinkingBlocks({ text: "single block" })).toEqual([
			"single block",
		]);
		expect(
			distinctThinkingBlocks({
				text: "inspect filesrun tests",
				blocks: ["inspect files", "run tests"],
			}),
		).toEqual(["inspect files", "run tests"]);
		expect(distinctThinkingBlocks({ text: "single block" })).toBeUndefined();
	});

	test("accumulator snapshots are immutable copies", () => {
		const accumulator = new ThinkingBlockAccumulator();
		accumulator.append({ text: "plan" });

		const snapshot = accumulator.snapshot();
		snapshot.blocks.push("mutated");

		expect(accumulator.snapshot().blocks).toEqual(["plan"]);
	});
});
