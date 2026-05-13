import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	listRepositoryTreeEntries,
	listTreeEntries,
} from "../../../../src/runtime/browser/files/tree-workbench.ts";

function makeTempRoot(prefix: string): { root: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), prefix));
	return {
		root,
		cleanup: () => rmSync(root, { force: true, recursive: true }),
	};
}

describe("listTreeEntries", () => {
	test("keeps browser-tree entries that are only ignored for mention search", async () => {
		const { root, cleanup } = makeTempRoot("outclaw-tree-policy-");
		try {
			mkdirSync(join(root, ".agents"));
			writeFileSync(join(root, ".agents", "agent.json"), "");
			mkdirSync(join(root, ".git"));
			writeFileSync(join(root, ".git", "HEAD"), "");
			writeFileSync(join(root, ".DS_Store"), "");
			writeFileSync(join(root, ".gitkeep"), "");

			await expect(listTreeEntries(root, root, new Map())).resolves.toEqual([
				{
					children: [
						{
							kind: "file",
							name: "agent.json",
							path: ".agents/agent.json",
						},
					],
					kind: "directory",
					name: ".agents",
					path: ".agents",
				},
				{
					kind: "file",
					name: ".gitkeep",
					path: ".gitkeep",
				},
			]);
		} finally {
			cleanup();
		}
	});

	test("marks shallow repository directories when descendants have git status", async () => {
		const { root, cleanup } = makeTempRoot("outclaw-repo-tree-status-");
		try {
			mkdirSync(join(root, "docs"));
			mkdirSync(join(root, "src", "feature"), { recursive: true });
			writeFileSync(join(root, "docs", "readme.md"), "");
			writeFileSync(join(root, "src", "index.ts"), "");
			writeFileSync(join(root, "src", "feature", "view.ts"), "");

			await expect(
				listRepositoryTreeEntries(
					root,
					root,
					new Map([
						["docs/readme.md", "modified"],
						["src/feature/view.ts", "new"],
					]),
					{ maxDepth: 1 },
				),
			).resolves.toEqual([
				{
					gitStatus: "modified",
					kind: "directory",
					name: "docs",
					path: "docs",
				},
				{
					gitStatus: "new",
					kind: "directory",
					name: "src",
					path: "src",
				},
			]);
		} finally {
			cleanup();
		}
	});
});
