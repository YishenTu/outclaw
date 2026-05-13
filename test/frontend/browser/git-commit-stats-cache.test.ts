import { afterEach, describe, expect, mock, test } from "bun:test";
import {
	clearGitCommitStatsCacheForTests,
	readCachedGitCommitStats,
} from "../../../src/frontend/browser/components/right-panel/git/git-commit-stats-cache.ts";

const globalScope = globalThis as unknown as { window?: unknown };
const originalFetch = globalThis.fetch;
const originalWindow = globalScope.window;

function installBrowserFetch() {
	globalScope.window = {
		location: {
			origin: "http://localhost",
		},
	};
}

describe("git commit stats cache", () => {
	afterEach(() => {
		clearGitCommitStatsCacheForTests();
		globalThis.fetch = originalFetch;
		if (originalWindow === undefined) {
			delete globalScope.window;
		} else {
			globalScope.window = originalWindow;
		}
	});

	test("deduplicates concurrent commit stats reads for the same repository commit", async () => {
		installBrowserFetch();
		const requests: string[] = [];
		globalThis.fetch = mock(async (input) => {
			requests.push(String(input));
			return new Response(
				JSON.stringify({
					sha: "abc123",
					files: [],
					totalAdditions: 0,
					totalDeletions: 0,
				}),
				{ headers: { "content-type": "application/json" } },
			);
		}) as unknown as typeof fetch;

		const [first, second] = await Promise.all([
			readCachedGitCommitStats({ repositoryId: "repo-1", sha: "abc123" }),
			readCachedGitCommitStats({ repositoryId: "repo-1", sha: "abc123" }),
		]);

		expect(first).toEqual(second);
		expect(requests).toHaveLength(1);
		expect(requests[0]).toContain("repositoryId=repo-1");
		expect(requests[0]).toContain("sha=abc123");
	});

	test("keeps commit stats cache scoped by repository", async () => {
		installBrowserFetch();
		const requests: string[] = [];
		globalThis.fetch = mock(async (input) => {
			requests.push(String(input));
			return new Response(
				JSON.stringify({
					sha: "abc123",
					files: [],
					totalAdditions: 0,
					totalDeletions: 0,
				}),
				{ headers: { "content-type": "application/json" } },
			);
		}) as unknown as typeof fetch;

		await readCachedGitCommitStats({ repositoryId: "repo-1", sha: "abc123" });
		await readCachedGitCommitStats({ repositoryId: "repo-2", sha: "abc123" });

		expect(requests).toHaveLength(2);
		expect(requests[0]).toContain("repositoryId=repo-1");
		expect(requests[1]).toContain("repositoryId=repo-2");
	});
});
