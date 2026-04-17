import { describe, expect, test } from "bun:test";
import { truncateGitGraphMessage } from "../../../src/frontend/browser/components/right-panel/git-graph-truncate.ts";

describe("truncateGitGraphMessage", () => {
	test("returns the original message when it fits", () => {
		expect(
			truncateGitGraphMessage("Short title", 20, (value) => value.length),
		).toBe("Short title");
	});

	test("uses three dots when truncation is required", () => {
		expect(
			truncateGitGraphMessage(
				"Add browser git graph compact layout",
				16,
				(value) => value.length,
			),
		).toBe("Add browser ...");
	});

	test("falls back to three dots when no title characters fit", () => {
		expect(
			truncateGitGraphMessage("Long title", 2, (value) => value.length),
		).toBe("...");
	});
});
