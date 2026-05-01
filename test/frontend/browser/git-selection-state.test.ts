import { describe, expect, test } from "bun:test";
import type { BrowserGitStatusResponse } from "../../../src/common/protocol.ts";
import { shouldClearSelectedGitCommit } from "../../../src/frontend/browser/components/right-panel/git/git-selection-state.ts";

const STATUS: BrowserGitStatusResponse = {
	initialized: true,
	root: "/repo",
	branch: "main",
	ahead: 0,
	behind: 0,
	clean: true,
	files: [],
	graph: {
		branchHeads: [],
		commits: [
			{
				sha: "abc123",
				commit: {
					author: {
						name: "A",
						date: "2026-04-29T00:00:00.000Z",
					},
					message: "Initial",
				},
				parents: [],
			},
		],
	},
};

describe("right panel git selection state", () => {
	test("keeps visible selected commits", () => {
		expect(
			shouldClearSelectedGitCommit({
				selectedCommitSha: "abc123",
				status: STATUS,
			}),
		).toBe(false);
	});

	test("clears missing commits and uninitialized status", () => {
		expect(
			shouldClearSelectedGitCommit({
				selectedCommitSha: "missing",
				status: STATUS,
			}),
		).toBe(true);
		expect(
			shouldClearSelectedGitCommit({
				selectedCommitSha: "abc123",
				status: { initialized: false, root: "/repo" },
			}),
		).toBe(true);
	});

	test("does nothing without a selected commit", () => {
		expect(
			shouldClearSelectedGitCommit({
				selectedCommitSha: null,
				status: null,
			}),
		).toBe(false);
	});
});
