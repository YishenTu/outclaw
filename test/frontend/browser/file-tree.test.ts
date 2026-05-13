import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import {
	browserTreeGitStatusEntries,
	FileTreeHeader,
	flattenBrowserTreePaths,
	reconcileExpandedDirectoryPaths,
	updateExpandedDirectoryPaths,
} from "../../../src/frontend/browser/components/right-panel/file-tree.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

describe("file tree adapters", () => {
	test("flattens the browser tree shape to directory and leaf file paths", () => {
		expect(
			flattenBrowserTreePaths([
				{
					kind: "directory",
					name: "src",
					path: "src",
					children: [
						{
							kind: "file",
							name: "index.ts",
							path: "src/index.ts",
						},
						{
							kind: "directory",
							name: "components",
							path: "src/components",
							children: [
								{
									kind: "file",
									name: "button.tsx",
									path: "src/components/button.tsx",
								},
							],
						},
					],
				},
				{
					kind: "file",
					name: "README.md",
					path: "README.md",
				},
			]),
		).toEqual([
			"src/",
			"src/index.ts",
			"src/components/",
			"src/components/button.tsx",
			"README.md",
		]);
	});

	test("maps browser git statuses to Pierre tree status entries", () => {
		expect(
			browserTreeGitStatusEntries([
				{
					kind: "directory",
					name: "src",
					path: "src",
					gitStatus: "new",
					children: [
						{
							kind: "file",
							name: "index.ts",
							path: "src/index.ts",
							gitStatus: "modified",
						},
						{
							kind: "file",
							name: "stable.ts",
							path: "src/stable.ts",
						},
					],
				},
			]),
		).toEqual([
			{ path: "src/", status: "untracked" },
			{ path: "src/index.ts", status: "modified" },
		]);
	});

	test("tracks expanded directory paths in Pierre's canonical slash form", () => {
		let expanded = new Set<string>();

		expanded = updateExpandedDirectoryPaths(expanded, "src", true);
		expanded = updateExpandedDirectoryPaths(expanded, "src/components/", true);
		expanded = updateExpandedDirectoryPaths(expanded, "src", false);

		expect([...expanded]).toEqual(["src/components/"]);
	});

	test("detects newly expanded directories independent of the click target", () => {
		const result = reconcileExpandedDirectoryPaths(new Set(["src/"]), [
			"src/",
			"src/components/",
			"docs",
		]);

		expect([...result.expandedPaths]).toEqual([
			"src/",
			"src/components/",
			"docs/",
		]);
		expect(result.newlyExpandedPaths).toEqual(["src/components", "docs"]);
	});

	test("renders the agents directory path on the same h-8 subheader row as git panel", () => {
		const html = renderToStaticMarkup(createElement(FileTreeHeader));

		expect(html).toContain("h-8 shrink-0 border-b border-dark-800");
		expect(html).toContain("~/.outclaw/agents/");
	});

	test("appends the active agent name to the subheader path", () => {
		const html = renderToStaticMarkup(
			createElement(FileTreeHeader, { agentName: "scout" }),
		);

		expect(html).toContain("~/.outclaw/agents/scout");
	});
});
