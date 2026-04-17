import { describe, expect, test } from "bun:test";
import { GitDiffContent } from "../../../src/frontend/browser/components/git-diff-viewer/git-diff-content.tsx";
import { GitDiffViewer } from "../../../src/frontend/browser/components/git-diff-viewer/git-diff-viewer.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

describe("GitDiffContent", () => {
	test("renders parsed hunks as a structured diff panel", () => {
		const html = renderToStaticMarkup(
			<GitDiffContent
				diff={{
					path: "agents/john-doe/AGENTS.md",
					diff: `diff --git a/agents/john-doe/AGENTS.md b/agents/john-doe/AGENTS.md
index cefe630..1111111 100644
--- a/agents/john-doe/AGENTS.md
+++ b/agents/john-doe/AGENTS.md
@@ -1,3 +1,2 @@
 # AGENTS.md
-
-You're a personal AI assistant that grows through collaboration.
+You're a personal AI assistant that collaborates through change.
`,
				}}
			/>,
		);

		expect(html).toContain("agents/john-doe/AGENTS.md");
		expect(html).toContain("Modified");
		expect(html).not.toContain("@@ -1,3 +1,2 @@");
		expect(html).toContain("bg-emerald-500/10");
		expect(html).toContain("bg-red-500/10");
		expect(html).toContain("tabular-nums");
		expect(html).toContain("grid-cols-[2.75rem_2.75rem_1rem_minmax(0,1fr)]");
		expect(html).not.toContain("grid-cols-[3rem_3rem_1.25rem_minmax(0,1fr)]");
		expect(html).not.toContain("grid-cols-[4rem_4rem_1.5rem_minmax(0,1fr)]");
		expect(html).toContain("font-mono min-w-0 px-3 py-1 whitespace-pre-wrap");
		expect(html).not.toContain("font-mono-ui whitespace-pre-wrap");
		expect(html).toContain("collaborates through change");
		expect(html).not.toContain("<pre");
	});

	test("renders parsed diffs without card borders or inner table grid lines", () => {
		const html = renderToStaticMarkup(
			<GitDiffContent
				diff={{
					path: "agents/john-doe/HEARTBEAT.md",
					diff: `diff --git a/agents/john-doe/HEARTBEAT.md b/agents/john-doe/HEARTBEAT.md
deleted file mode 100644
index cefe630..0000000
--- a/agents/john-doe/HEARTBEAT.md
+++ /dev/null
@@ -1,2 +0,0 @@
-# Heartbeat
-
`,
				}}
			/>,
		);

		expect(html).not.toContain("border border-dark-800");
		expect(html).not.toContain("border-b border-dark-800");
		expect(html).not.toContain("divide-y");
		expect(html).not.toContain("border-r border-dark-950/70");
		expect(html).not.toContain("border-emerald-500/30");
		expect(html).not.toContain("border-red-500/30");
		expect(html).not.toContain("bg-emerald-500/10 px-2 py-1");
		expect(html).not.toContain("bg-red-500/10 px-2 py-1");
	});

	test("falls back to raw diff output when the payload has no structured hunks", () => {
		const html = renderToStaticMarkup(
			<GitDiffContent
				diff={{
					path: "README.md",
					diff: "Binary files a/README.md and b/README.md differ\n",
				}}
			/>,
		);

		expect(html).toContain("Raw diff");
		expect(html).toContain("Binary files a/README.md and b/README.md differ");
	});

	test("renders an empty-state message when there is no diff output", () => {
		const html = renderToStaticMarkup(
			<GitDiffContent
				diff={{
					path: "README.md",
					diff: "",
				}}
			/>,
		);

		expect(html).toContain("No diff output.");
	});
});

describe("GitDiffViewer", () => {
	test("does not render a manual refresh button in the diff header", () => {
		const html = renderToStaticMarkup(<GitDiffViewer path="AGENTS.md" />);

		expect(html).toContain("Git diff / AGENTS.md");
		expect(html).not.toContain("Refresh");
	});
});
