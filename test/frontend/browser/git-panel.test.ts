import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import type { BrowserGitInitializedResponse } from "../../../src/common/protocol.ts";
import {
	GitPanel,
	GitPanelHeader,
	shouldLoadMoreGitHistory,
} from "../../../src/frontend/browser/components/right-panel/git/git-panel.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

function gitStatus(
	overrides: Partial<BrowserGitInitializedResponse> = {},
): BrowserGitInitializedResponse {
	return {
		initialized: true,
		root: "/tmp/outclaw",
		branch: "main",
		ahead: 0,
		behind: 0,
		clean: true,
		history: { commits: [] },
		files: [],
		...overrides,
	};
}

describe("git panel header", () => {
	test("loads more commit history only near the bottom of a pageable history scroller", () => {
		expect(
			shouldLoadMoreGitHistory({
				clientHeight: 200,
				hasMore: true,
				loading: false,
				scrollHeight: 1000,
				scrollTop: 680,
			}),
		).toBe(true);
		expect(
			shouldLoadMoreGitHistory({
				clientHeight: 200,
				hasMore: true,
				loading: false,
				scrollHeight: 1000,
				scrollTop: 679,
			}),
		).toBe(false);
		expect(
			shouldLoadMoreGitHistory({
				clientHeight: 200,
				hasMore: false,
				loading: false,
				scrollHeight: 1000,
				scrollTop: 680,
			}),
		).toBe(false);
		expect(
			shouldLoadMoreGitHistory({
				clientHeight: 200,
				hasMore: true,
				loading: true,
				scrollHeight: 1000,
				scrollTop: 680,
			}),
		).toBe(false);
	});

	test("renders the branch and change summary on the same h-8 subheader row", () => {
		const html = renderToStaticMarkup(
			createElement(GitPanelHeader, {
				status: gitStatus({
					clean: false,
					files: [
						{
							path: "src/app.ts",
							indexStatus: "M",
							worktreeStatus: "M",
							additions: 3,
							deletions: 1,
						},
						{
							path: "README.md",
							indexStatus: " ",
							worktreeStatus: "M",
							additions: 1,
							deletions: 1,
						},
					],
				}),
			}),
		);

		expect(html).toContain("h-8 shrink-0 border-b border-dark-800");
		expect(html).toContain("Branch main");
		expect(html).toContain("2 changed files");
		expect(html).toContain("items-center justify-between");
		expect(html.indexOf("Branch main")).toBeLessThan(
			html.indexOf("2 changed files"),
		);
	});

	test("renders a commit button in the subheader when the working tree is dirty", () => {
		const html = renderToStaticMarkup(
			createElement(GitPanelHeader, {
				status: gitStatus({
					clean: false,
					files: [
						{
							path: "src/app.ts",
							indexStatus: "M",
							worktreeStatus: "M",
							additions: 1,
							deletions: 0,
						},
					],
				}),
				onCommit() {},
			}),
		);

		expect(html).toContain(">Commit and push<");
		expect(html).toContain(
			'aria-label="Send commit and push prompt to active agent"',
		);
	});

	test("omits the clean summary and commit button from the subheader when the working tree is clean", () => {
		const html = renderToStaticMarkup(
			createElement(GitPanelHeader, {
				status: gitStatus(),
				onCommit() {},
			}),
		);

		expect(html).not.toContain(">clean<");
		expect(html).not.toContain(">Commit and push<");
		expect(html).not.toContain(
			'aria-label="Send commit and push prompt to active agent"',
		);
	});

	test("renders structured commit history instead of a visual graph", () => {
		const html = renderToStaticMarkup(
			createElement(GitPanel, {
				status: gitStatus({
					clean: false,
					history: {
						commits: [
							{
								sha: "bbbbbbb",
								commit: {
									author: {
										name: "Test User",
										date: "2026-04-17T00:00:00.000Z",
									},
									message: "Second commit",
								},
								parents: [{ sha: "aaaaaaa" }],
							},
							{
								sha: "aaaaaaa",
								commit: {
									author: {
										name: "Test User",
										date: "2026-04-16T00:00:00.000Z",
									},
									message: "Initial commit",
								},
								parents: [],
							},
						],
					},
					files: [],
				}),
				loading: false,
				error: null,
				onOpenDiff() {},
			}),
		);

		expect(html).toContain("Commit history");
		expect(html).toContain("commit-history-list");
		expect(html).toContain("Second commit");
		expect(html).toContain("Initial commit");
		expect(html).toContain("bbbbbbb");
		expect(html).not.toContain("git-graph-shell");
		expect(html).not.toContain("<pre");
	});

	test("renders infinite-scroll history loading feedback without a pagination button", () => {
		const html = renderToStaticMarkup(
			createElement(GitPanel, {
				status: gitStatus({
					history: {
						commits: [
							{
								sha: "bbbbbbb",
								commit: {
									author: {
										name: "Test User",
										date: "2026-04-17T00:00:00.000Z",
									},
									message: "Second commit",
								},
								parents: [{ sha: "aaaaaaa" }],
							},
						],
						nextCursor: "30",
					},
				}),
				historyLoadingMore: true,
				loading: false,
				error: null,
				onOpenDiff() {},
			}),
		);

		expect(html).toContain("Loading older commits");
		expect(html).not.toContain("Load more");
		expect(html).not.toContain("Next page");
	});

	test("splits changed files and commit history into equal-height scroll regions", () => {
		const html = renderToStaticMarkup(
			createElement(GitPanel, {
				status: gitStatus({
					clean: false,
					files: [
						{
							path: "src/app.ts",
							indexStatus: "M",
							worktreeStatus: "M",
							additions: 3,
							deletions: 1,
						},
					],
				}),
				loading: false,
				error: null,
				onOpenDiff() {},
			}),
		);

		expect(html).toContain("flex min-h-0 flex-1 flex-col gap-4 px-3 py-3");
		expect(
			html.match(/<section class="flex min-h-0 flex-1 flex-col">/g),
		).toHaveLength(2);
		expect(
			html.match(/scrollbar-none min-h-0 flex-1 overflow-y-auto/g),
		).toHaveLength(2);
	});

	test("colors modified changed files with a pale yellow tone", () => {
		const html = renderToStaticMarkup(
			createElement(GitPanel, {
				status: gitStatus({
					clean: false,
					files: [
						{
							path: "src/app.ts",
							indexStatus: " ",
							worktreeStatus: "M",
							additions: 2,
							deletions: 1,
						},
						{
							path: "notes/todo.md",
							indexStatus: "?",
							worktreeStatus: "?",
							additions: 2,
							deletions: 0,
						},
					],
				}),
				loading: false,
				error: null,
				onOpenDiff() {},
			}),
		);

		expect(html).toContain("text-warning");
		expect(html).toContain("text-success");
		expect(html).not.toContain("text-brand");
		expect(html).not.toContain(">-0<");
	});

	test("renders line change counts instead of raw git status letters", () => {
		const html = renderToStaticMarkup(
			createElement(GitPanel, {
				status: gitStatus({
					clean: false,
					files: [
						{
							path: "src/app.ts",
							indexStatus: "M",
							worktreeStatus: "M",
							additions: 3,
							deletions: 1,
						},
					],
				}),
				loading: false,
				error: null,
				onOpenDiff() {},
			}),
		);

		expect(html).toContain("+3");
		expect(html).toContain("-1");
		expect(html).not.toContain(">MM<");
	});

	test("renders deleted files in a pale red tone", () => {
		const html = renderToStaticMarkup(
			createElement(GitPanel, {
				status: gitStatus({
					clean: false,
					files: [
						{
							path: "src/old.ts",
							indexStatus: " ",
							worktreeStatus: "D",
							additions: 0,
							deletions: 3,
						},
					],
				}),
				loading: false,
				error: null,
				onOpenDiff() {},
			}),
		);

		expect(html).toContain("text-danger");
		expect(html).toContain("-3");
		expect(html).not.toContain(">+0<");
	});

	test("renders a collapse control on the commit history header", () => {
		const html = renderToStaticMarkup(
			createElement(GitPanel, {
				status: gitStatus({ clean: false }),
				loading: false,
				error: null,
				onOpenDiff() {},
			}),
		);

		expect(html).toContain("Commit history");
		expect(html).toContain('aria-label="Collapse commit history"');
		expect(html).toContain("lucide-chevron-down");
		expect(html).not.toContain("lucide-chevron-up");
		expect(html).not.toContain("git graph");
		expect(html).toContain(
			"mb-2 flex shrink-0 items-center justify-between gap-3 px-2",
		);
	});

	test("can render the commit history collapsed to a header-only strip", () => {
		const html = renderToStaticMarkup(
			createElement(GitPanel, {
				status: gitStatus({
					clean: false,
					history: {
						commits: [
							{
								sha: "bbbbbbb",
								commit: {
									author: {
										name: "Test User",
										date: "2026-04-17T00:00:00.000Z",
									},
									message: "Second commit",
								},
								parents: [{ sha: "aaaaaaa" }],
							},
						],
					},
					files: [],
				}),
				loading: false,
				error: null,
				onOpenDiff() {},
				historyCollapsed: true,
			}),
		);

		expect(html).toContain('aria-label="Expand commit history"');
		expect(html).toContain("lucide-chevron-up");
		expect(html).not.toContain("lucide-chevron-down");
		expect(html).toContain('<section class="flex shrink-0 flex-col">');
		expect(html).not.toContain("commit-history-list");
		expect(html).not.toContain("Second commit");
	});

	test("renders an uninitialized card with an init button when the git root is not a repo", () => {
		const html = renderToStaticMarkup(
			createElement(GitPanel, {
				status: {
					initialized: false,
					root: "/tmp/outclaw-new",
				} as never,
				loading: false,
				error: null,
				onOpenDiff() {},
			}),
		);

		expect(html).toContain("Not a git repository");
		expect(html).toContain("/tmp/outclaw-new");
		expect(html).toContain(">Initialize repository<");
		expect(html).toContain(
			'aria-label="Initialize git repository in the working directory"',
		);
		expect(html).not.toContain("Changed files");
		expect(html).not.toContain("Commit history");
	});

	test("renders the selected commit card inline under the selected history row", () => {
		const html = renderToStaticMarkup(
			createElement(GitPanel, {
				status: gitStatus({
					clean: false,
					history: {
						commits: [
							{
								sha: "bbbbbbb1234567",
								commit: {
									author: {
										name: "Test User",
										date: "2026-04-17T12:34:56.000Z",
									},
									message: "Second commit",
								},
								parents: [{ sha: "aaaaaaa7654321" }],
							},
						],
					},
					files: [],
				}),
				loading: false,
				error: null,
				onOpenDiff() {},
				onOpenCommit() {},
				selectedCommitSha: "bbbbbbb1234567",
			}),
		);

		expect(html).toContain("Second commit");
		expect(html).toContain("bbbbbbb");
		expect(html).toContain("Loading changes");
		expect(html).toContain("commit-history-selected-card");
		expect(html).not.toContain("Parents");
		expect(html.indexOf("commit-history-list")).toBeLessThan(
			html.indexOf("commit-history-selected-card"),
		);
	});
});
