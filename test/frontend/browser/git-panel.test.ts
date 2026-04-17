import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { GitPanelHeader } from "../../../src/frontend/browser/components/right-panel/git-panel.tsx";
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
					graph: "",
					files: [
						{
							path: "src/app.ts",
							indexStatus: "M",
							worktreeStatus: "M",
						},
						{
							path: "README.md",
							indexStatus: " ",
							worktreeStatus: "M",
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
});
