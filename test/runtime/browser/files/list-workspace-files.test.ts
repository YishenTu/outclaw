import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	listRepositoryWorkspaceFiles,
	listWorkspaceFiles,
} from "../../../../src/runtime/browser/files/list-workspace-files.ts";

function makeTempRoot(prefix: string): { root: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), prefix));
	return {
		root,
		cleanup: () => rmSync(root, { force: true, recursive: true }),
	};
}

describe("listWorkspaceFiles", () => {
	test("returns flat list of files and directories sorted by path", async () => {
		const { root, cleanup } = makeTempRoot("outclaw-files-");
		try {
			mkdirSync(join(root, "src"));
			mkdirSync(join(root, "src", "nested"));
			writeFileSync(join(root, "README.md"), "");
			writeFileSync(join(root, "src", "index.ts"), "");
			writeFileSync(join(root, "src", "nested", "deep.ts"), "");

			const entries = await listWorkspaceFiles(root);

			expect(entries).toEqual([
				{ kind: "file", path: "README.md" },
				{ kind: "directory", path: "src" },
				{ kind: "file", path: "src/index.ts" },
				{ kind: "directory", path: "src/nested" },
				{ kind: "file", path: "src/nested/deep.ts" },
			]);
		} finally {
			cleanup();
		}
	});

	test("skips ignored directories and files", async () => {
		const { root, cleanup } = makeTempRoot("outclaw-files-skip-");
		try {
			mkdirSync(join(root, ".git"));
			writeFileSync(join(root, ".git", "HEAD"), "");
			mkdirSync(join(root, ".obsidian"));
			writeFileSync(join(root, ".obsidian", "workspace.json"), "");
			mkdirSync(join(root, ".claude"));
			writeFileSync(join(root, ".claude", "settings.json"), "");
			mkdirSync(join(root, ".agents"));
			writeFileSync(join(root, ".agents", "agent.json"), "");
			writeFileSync(join(root, ".agent-id"), "agent-railly\n");
			mkdirSync(join(root, "node_modules"));
			writeFileSync(join(root, "node_modules", "package.js"), "");
			mkdirSync(join(root, "dist"));
			writeFileSync(join(root, "dist", "bundle.js"), "");
			mkdirSync(join(root, "build"));
			writeFileSync(join(root, "build", "artifact.js"), "");
			writeFileSync(join(root, ".DS_Store"), "");
			writeFileSync(join(root, ".gitkeep"), "");
			writeFileSync(join(root, "keep.md"), "");

			const entries = await listWorkspaceFiles(root);

			expect(entries.map((entry) => entry.path)).toEqual(["keep.md"]);
		} finally {
			cleanup();
		}
	});

	test("includes dotfiles other than the ignored set", async () => {
		const { root, cleanup } = makeTempRoot("outclaw-files-dot-");
		try {
			writeFileSync(join(root, ".env"), "");
			writeFileSync(join(root, ".gitignore"), "");

			const entries = await listWorkspaceFiles(root);

			expect(entries.map((entry) => entry.path).sort()).toEqual([
				".env",
				".gitignore",
			]);
		} finally {
			cleanup();
		}
	});

	test("returns empty list for empty directory", async () => {
		const { root, cleanup } = makeTempRoot("outclaw-files-empty-");
		try {
			expect(await listWorkspaceFiles(root)).toEqual([]);
		} finally {
			cleanup();
		}
	});

	test("limits collected entries", async () => {
		const { root, cleanup } = makeTempRoot("outclaw-files-limit-");
		try {
			writeFileSync(join(root, "a.md"), "");
			writeFileSync(join(root, "b.md"), "");
			writeFileSync(join(root, "c.md"), "");

			const entries = await listWorkspaceFiles(root, { limit: 2 });

			expect(entries).toHaveLength(2);
		} finally {
			cleanup();
		}
	});

	test("repository workspace files ignore only git metadata", async () => {
		const { root, cleanup } = makeTempRoot("outclaw-repo-files-");
		try {
			mkdirSync(join(root, ".git"));
			writeFileSync(join(root, ".git", "HEAD"), "");
			writeFileSync(join(root, ".DS_Store"), "");
			mkdirSync(join(root, "node_modules"));
			writeFileSync(join(root, "node_modules", "package.js"), "");
			writeFileSync(join(root, ".gitignore"), "");
			writeFileSync(join(root, "README.md"), "");

			const entries = await listRepositoryWorkspaceFiles(root);

			expect(entries).toEqual([
				{ kind: "file", path: ".gitignore" },
				{ kind: "directory", path: "node_modules" },
				{ kind: "file", path: "node_modules/package.js" },
				{ kind: "file", path: "README.md" },
			]);
		} finally {
			cleanup();
		}
	});
});
