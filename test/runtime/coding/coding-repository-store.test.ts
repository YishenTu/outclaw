import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodingRepositoryStore } from "../../../src/runtime/coding/index.ts";

function createStore() {
	const dbPath = join(
		mkdtempSync(join(tmpdir(), "outclaw-coding-repos-")),
		"sessions.sqlite",
	);
	const repositories = new CodingRepositoryStore(dbPath, {
		journalMode: "DELETE",
	});
	return { dbPath, repositories };
}

describe("CodingRepositoryStore", () => {
	test("registers repositories by canonical root and reactivates archived entries", () => {
		const { repositories } = createStore();
		const root = mkdtempSync(join(tmpdir(), "outclaw-repo-root-"));
		const link = join(
			mkdtempSync(join(tmpdir(), "outclaw-repo-link-")),
			"repo",
		);
		symlinkSync(root, link, "dir");

		const first = repositories.register({
			displayName: "Outclaw",
			rootCwd: root,
			source: "manual",
			timestamp: 10,
		});
		repositories.archive(first.id, 20);
		const second = repositories.register({
			rootCwd: link,
			source: "auto",
			timestamp: 30,
		});

		expect(second).toMatchObject({
			id: first.id,
			rootCwd: realpathSync(root),
			displayName: expect.stringMatching(/^outclaw-repo-root-/),
			source: "manual",
			status: "active",
			createdAt: 10,
			lastActive: 30,
		});
		expect(second).not.toHaveProperty("defaultAgentId");
		expect(repositories.list()).toEqual([second]);
		expect(repositories.list({ includeArchived: true })).toEqual([second]);

		repositories.close();
	});

	test("auto registration groups nested cwd under the nearest git root", () => {
		const { repositories } = createStore();
		const root = mkdtempSync(join(tmpdir(), "outclaw-git-repo-"));
		const nested = join(root, "packages", "app");
		mkdirSync(join(root, ".git"), { recursive: true });
		mkdirSync(nested, { recursive: true });

		const repository = repositories.registerForCwd({
			cwd: nested,
			timestamp: 10,
		});

		expect(repository).toMatchObject({
			rootCwd: realpathSync(root),
			displayName: expect.stringMatching(/^outclaw-git-repo-/),
			source: "auto",
			status: "active",
		});
		expect(repository).not.toHaveProperty("defaultAgentId");

		repositories.close();
	});
});
