import { describe, expect, test } from "bun:test";
import type {
	BrowserGitHistory,
	BrowserGitInitializedResponse,
} from "../../../src/common/protocol.ts";
import { appendGitHistoryPage } from "../../../src/frontend/browser/components/right-panel/git/git-history-pagination.ts";

function commit(sha: string, message: string) {
	return {
		sha,
		commit: {
			author: {
				name: "Test User",
				date: "2026-05-12T00:00:00.000Z",
			},
			message,
		},
		parents: [],
	};
}

function status(history: BrowserGitHistory): BrowserGitInitializedResponse {
	return {
		initialized: true,
		root: "/tmp/outclaw",
		branch: "main",
		ahead: 0,
		behind: 0,
		clean: true,
		files: [],
		history,
	};
}

describe("git history pagination", () => {
	test("appends older commit pages and ignores duplicate commits", () => {
		const nextStatus = appendGitHistoryPage(
			status({
				commits: [commit("new", "New commit"), commit("shared", "Shared")],
				nextCursor: "30",
			}),
			"30",
			{
				commits: [commit("shared", "Shared"), commit("old", "Old commit")],
				nextCursor: "60",
			},
		);

		if (!nextStatus?.initialized) {
			throw new Error("expected initialized git status");
		}
		expect(nextStatus.history.commits.map((entry) => entry.sha)).toEqual([
			"new",
			"shared",
			"old",
		]);
		expect(nextStatus.history.nextCursor).toBe("60");
	});

	test("leaves status unchanged when an older request returns after the cursor moved", () => {
		const current = status({
			commits: [commit("new", "New commit")],
			nextCursor: "60",
		});

		expect(
			appendGitHistoryPage(current, "30", {
				commits: [commit("old", "Old commit")],
			}),
		).toBe(current);
	});
});
