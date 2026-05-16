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

			const entries = await listWorkspaceFiles(root, {
				ignoredNames: [".claude", ".codex"],
			});

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
			mkdirSync(join(root, ".codex"));
			writeFileSync(join(root, ".codex", "config.toml"), "");
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

			const entries = await listWorkspaceFiles(root, {
				ignoredNames: [".claude", ".codex"],
			});

			expect(entries.map((entry) => entry.path)).toEqual(["keep.md"]);
		} finally {
			cleanup();
		}
	});

	test("does not bake provider workspace names into the default ignore list", async () => {
		const { root, cleanup } = makeTempRoot("outclaw-files-provider-");
		try {
			mkdirSync(join(root, ".claude"));
			writeFileSync(join(root, ".claude", "settings.json"), "");
			mkdirSync(join(root, ".codex"));
			writeFileSync(join(root, ".codex", "config.toml"), "");

			const entries = await listWorkspaceFiles(root);

			expect(entries.map((entry) => entry.path)).toEqual([
				".claude",
				".claude/settings.json",
				".codex",
				".codex/config.toml",
			]);
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

	test("repository workspace files skip dependency and generated directories", async () => {
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
				{ kind: "file", path: "README.md" },
			]);
		} finally {
			cleanup();
		}
	});

	test("repository workspace files honor git ignored files", async () => {
		const { root, cleanup } = makeTempRoot("outclaw-repo-git-files-");
		try {
			writeFileSync(join(root, ".gitignore"), "scratch/\n");
			mkdirSync(join(root, "scratch"));
			writeFileSync(join(root, "scratch", "ignored.md"), "");
			mkdirSync(join(root, "node_modules", "dependency"), {
				recursive: true,
			});
			writeFileSync(join(root, "node_modules", "dependency", "index.js"), "");
			mkdirSync(join(root, "packages", "app", "node_modules", "dependency"), {
				recursive: true,
			});
			writeFileSync(
				join(root, "packages", "app", "node_modules", "dependency", "index.js"),
				"",
			);
			mkdirSync(join(root, "src"));
			writeFileSync(join(root, "src", "index.ts"), "");
			const init = Bun.spawnSync(["git", "init", "--initial-branch=main"], {
				cwd: root,
				stderr: "pipe",
				stdout: "pipe",
			});
			expect(init.exitCode).toBe(0);

			const entries = await listRepositoryWorkspaceFiles(root);

			expect(entries).toEqual([
				{ kind: "file", path: ".gitignore" },
				{ kind: "directory", path: "src" },
				{ kind: "file", path: "src/index.ts" },
			]);
		} finally {
			cleanup();
		}
	});

	test("repository workspace files preserve git paths with leading and trailing spaces", async () => {
		const { root, cleanup } = makeTempRoot("outclaw-repo-spaced-files-");
		try {
			const init = Bun.spawnSync(["git", "init", "--initial-branch=main"], {
				cwd: root,
				stderr: "pipe",
				stdout: "pipe",
			});
			expect(init.exitCode).toBe(0);
			mkdirSync(join(root, "src"));
			writeFileSync(join(root, " leading.ts"), "");
			writeFileSync(join(root, "src", "trailing.ts "), "");

			const entries = await listRepositoryWorkspaceFiles(root);

			expect(entries).toEqual([
				{ kind: "file", path: " leading.ts" },
				{ kind: "directory", path: "src" },
				{ kind: "file", path: "src/trailing.ts " },
			]);
		} finally {
			cleanup();
		}
	});
});
