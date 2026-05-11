import { describe, expect, test } from "bun:test";
import type { BrowserGitDiffResponse } from "../../../src/common/protocol.ts";
import {
	GitDiffContent,
	languageForDiffPath,
	pierreDiffFiles,
} from "../../../src/frontend/browser/components/git-diff-viewer/git-diff-content.tsx";
import { GitDiffViewer } from "../../../src/frontend/browser/components/git-diff-viewer/git-diff-viewer.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

function structuredDiff(): BrowserGitDiffResponse {
	return {
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
	};
}

describe("GitDiffContent", () => {
	test("detects the language from the changed file path", () => {
		expect(languageForDiffPath("src/index.ts")).toBe("typescript");
		expect(languageForDiffPath("src/index.tsx")).toBe("typescript");
		expect(languageForDiffPath("src/index.js")).toBe("javascript");
		expect(languageForDiffPath("src/index.jsx")).toBe("javascript");
		expect(languageForDiffPath("README.md")).toBe("markdown");
		expect(languageForDiffPath("package.json")).toBe("json");
		expect(languageForDiffPath("src/index.css")).toBe("css");
		expect(languageForDiffPath("src/index.html")).toBe("html");
		expect(languageForDiffPath("config.yaml")).toBe("yaml");
		expect(languageForDiffPath("config.yml")).toBe("yaml");
		expect(languageForDiffPath("scripts/run.sh")).toBe("shell");
		expect(languageForDiffPath("notes.txt")).toBe("text");
	});

	test("parses patch files through Pierre and applies language overrides", () => {
		const files = pierreDiffFiles({
			path: "src/index.ts",
			diff: `diff --git a/src/index.ts b/src/index.ts
index 1111111..2222222 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1 +1 @@
-const value = 1;
+const value = 2;
diff --git a/README.md b/README.md
index 3333333..4444444 100644
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-# Old
+# New
`,
		});

		expect(files.map((file) => [file.name, file.lang])).toEqual([
			["src/index.ts", "typescript"],
			["README.md", "markdown"],
		]);
	});

	test("renders Pierre diff components for structured patches", () => {
		const html = renderToStaticMarkup(
			<GitDiffContent diff={structuredDiff()} />,
		);

		expect(html).toContain("<diffs-container");
		expect(html).not.toContain(
			"grid-cols-[2.75rem_2.75rem_1rem_minmax(0,1fr)]",
		);
		expect(html).not.toContain("bg-success/10");
		expect(html).not.toContain("bg-danger/10");
	});

	test("passes an explicit split diff style to Pierre diff components", () => {
		const html = renderToStaticMarkup(
			<GitDiffContent diff={structuredDiff()} diffStyle="split" />,
		);

		expect(html).toContain('data-diff-style="split"');
	});

	test("defaults Pierre diff components to unified diff style", () => {
		const html = renderToStaticMarkup(
			<GitDiffContent diff={structuredDiff()} />,
		);

		expect(html).toContain('data-diff-style="unified"');
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
	test("uses the shared hidden-scrollbar preview container without a manual refresh button", () => {
		const html = renderToStaticMarkup(
			<GitDiffViewer path="agents/john-doe/AGENTS.md" />,
		);

		expect(html).toContain("Git diff / agents/john-doe/AGENTS.md");
		expect(html).toContain(
			"scrollbar-none min-h-0 flex-1 overflow-y-auto px-6 py-6",
		);
		expect(html).not.toContain("Refresh");
	});
});
