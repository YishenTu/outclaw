import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import {
	FileTreeHeader,
	fileKindForPath,
	fileNodePaddingLeft,
	isTreeNodeExpanded,
	treeEntryToneClass,
	treeNodePaddingLeft,
} from "../../../src/frontend/browser/components/right-panel/file-tree.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

describe("file tree helpers", () => {
	test("folders are collapsed by default", () => {
		expect(isTreeNodeExpanded({}, "src")).toBe(false);
		expect(isTreeNodeExpanded({ src: true }, "src")).toBe(true);
	});

	test("nested entries use deeper indentation", () => {
		expect(treeNodePaddingLeft(0)).toBe("12px");
		expect(treeNodePaddingLeft(1)).toBe("30px");
		expect(treeNodePaddingLeft(2)).toBe("48px");
		expect(fileNodePaddingLeft(0)).toBe("34px");
		expect(fileNodePaddingLeft(1)).toBe("52px");
	});

	test("chooses file kinds from file extensions", () => {
		expect(fileKindForPath("README.md")).toBe("markdown");
		expect(fileKindForPath("src/index.ts")).toBe("code");
		expect(fileKindForPath("package.json")).toBe("json");
		expect(fileKindForPath("screenshot.png")).toBe("image");
		expect(fileKindForPath("notes.txt")).toBe("default");
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

	test("uses IDE-style colors for modified and new git tree entries", () => {
		expect(
			treeEntryToneClass({
				kind: "file",
				name: "AGENTS.md",
				path: "AGENTS.md",
				gitStatus: "modified",
			}),
		).toContain("text-brand");
		expect(
			treeEntryToneClass({
				kind: "file",
				name: "todo.md",
				path: "notes/todo.md",
				gitStatus: "new",
			}),
		).toContain("text-success");
		expect(
			treeEntryToneClass({
				kind: "directory",
				name: "notes",
				path: "notes",
				gitStatus: "new",
			}),
		).toContain("text-success");
		expect(
			treeEntryToneClass({
				kind: "file",
				name: "README.md",
				path: "README.md",
			}),
		).toContain("text-dark-400");
	});
});
