import { describe, expect, test } from "bun:test";
import {
	COMPACT_BOUNDARY_TEXT,
	createDisplayCompactBoundaryMessage,
	formatCompactBoundaryIndicator,
} from "../../src/common/compact-boundary.ts";

describe("compact boundary display contract", () => {
	test("creates a live compact boundary message without provider metadata", () => {
		expect(createDisplayCompactBoundaryMessage()).toEqual({
			kind: "system",
			event: "compact_boundary",
			text: COMPACT_BOUNDARY_TEXT,
		});
	});

	test("normalizes parsed history metadata", () => {
		expect(
			createDisplayCompactBoundaryMessage({
				trigger: "manual",
				preTokens: 123,
			}),
		).toEqual({
			kind: "system",
			event: "compact_boundary",
			text: COMPACT_BOUNDARY_TEXT,
			trigger: "manual",
			preTokens: 123,
		});
		expect(createDisplayCompactBoundaryMessage({ trigger: "auto" })).toEqual({
			kind: "system",
			event: "compact_boundary",
			text: COMPACT_BOUNDARY_TEXT,
			trigger: "auto",
			preTokens: 0,
		});
	});

	test("formats the shared transcript indicator label", () => {
		expect(formatCompactBoundaryIndicator()).toBe("~ context compacted ~");
	});
});
