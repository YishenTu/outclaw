import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import {
	GitPanel,
	GitPanelHeader,
} from "../../../src/frontend/browser/components/right-panel/git-panel.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

describe("git panel header", () => {
	test("renders the branch and change summary on the same h-8 subheader row", () => {
		const html = renderToStaticMarkup(
			createElement(GitPanelHeader, {
				status: {
					root: "/tmp/outclaw",
					branch: "main",
					ahead: 0,
					behind: 0,
					clean: false,
					graph: { commits: [], branchHeads: [] },
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
				},
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

	test("renders a lightweight structured git graph instead of raw preformatted text", () => {
		const html = renderToStaticMarkup(
			createElement(GitPanel, {
				status: {
					root: "/tmp/outclaw",
					branch: "main",
					ahead: 0,
					behind: 0,
					clean: false,
					graph: {
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
						branchHeads: [
							{
								name: "main",
								commit: {
									sha: "bbbbbbb",
								},
							},
						],
					},
					files: [],
				} as never,
				loading: false,
				error: null,
				onOpenDiff() {},
			}),
		);

		expect(html).toContain("git-graph-shell");
		expect(html).toContain("git-graph-canvas");
		expect(html).toContain("overflow-hidden");
		expect(html).toContain("w-full min-w-0");
		expect(html).toContain("Second commit");
		expect(html).toContain("Initial commit");
		expect(html).not.toContain("<pre");
	});

	test("splits changed files and git graph into equal-height scroll regions", () => {
		const html = renderToStaticMarkup(
			createElement(GitPanel, {
				status: {
					root: "/tmp/outclaw",
					branch: "main",
					ahead: 0,
					behind: 0,
					clean: false,
					graph: { commits: [], branchHeads: [] },
					files: [
						{
							path: "src/app.ts",
							indexStatus: "M",
							worktreeStatus: "M",
							additions: 3,
							deletions: 1,
						},
					],
				},
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
				status: {
					root: "/tmp/outclaw",
					branch: "main",
					ahead: 0,
					behind: 0,
					clean: false,
					graph: { commits: [], branchHeads: [] },
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
				},
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
				status: {
					root: "/tmp/outclaw",
					branch: "main",
					ahead: 0,
					behind: 0,
					clean: false,
					graph: { commits: [], branchHeads: [] },
					files: [
						{
							path: "src/app.ts",
							indexStatus: "M",
							worktreeStatus: "M",
							additions: 3,
							deletions: 1,
						},
					],
				},
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
				status: {
					root: "/tmp/outclaw",
					branch: "main",
					ahead: 0,
					behind: 0,
					clean: false,
					graph: { commits: [], branchHeads: [] },
					files: [
						{
							path: "src/old.ts",
							indexStatus: " ",
							worktreeStatus: "D",
							additions: 0,
							deletions: 3,
						},
					],
				},
				loading: false,
				error: null,
				onOpenDiff() {},
			}),
		);

		expect(html).toContain("text-danger");
		expect(html).toContain("-3");
		expect(html).not.toContain(">+0<");
	});

	test("renders a collapse control on the git graph header", () => {
		const html = renderToStaticMarkup(
			createElement(GitPanel, {
				status: {
					root: "/tmp/outclaw",
					branch: "main",
					ahead: 0,
					behind: 0,
					clean: false,
					graph: { commits: [], branchHeads: [] },
					files: [],
				},
				loading: false,
				error: null,
				onOpenDiff() {},
			}),
		);

		expect(html).toContain('aria-label="Collapse git graph"');
		expect(html).toContain(
			"mb-2 flex shrink-0 items-center justify-between gap-3 px-2",
		);
		expect(html).toContain(">Git graph</div><div");
		expect(html).toContain("flex w-8 shrink-0 justify-end");
		expect(html).toContain("flex items-center justify-end text-dark-500");
		expect(html).toContain("lucide-chevron-down");
		expect(html).not.toContain(">^</button>");
	});

	test("can render the git graph collapsed to a header-only strip", () => {
		const html = renderToStaticMarkup(
			createElement(GitPanel, {
				status: {
					root: "/tmp/outclaw",
					branch: "main",
					ahead: 0,
					behind: 0,
					clean: false,
					graph: {
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
						branchHeads: [],
					},
					files: [],
				} as never,
				loading: false,
				error: null,
				onOpenDiff() {},
				graphCollapsed: true,
			}),
		);

		expect(html).toContain('aria-label="Expand git graph"');
		expect(html).toContain("lucide-chevron-up");
		expect(html).not.toContain(">v</button>");
		expect(html).toContain('<section class="flex shrink-0 flex-col">');
		expect(html).not.toContain("git-graph-shell");
	});
});
