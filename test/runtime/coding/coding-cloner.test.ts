import { describe, expect, test } from "bun:test";
import {
	createGitCloner,
	deriveRepoNameFromUrl,
} from "../../../src/runtime/coding/coding-cloner.ts";

describe("deriveRepoNameFromUrl", () => {
	test.each([
		["https://github.com/foo/bar.git", "bar"],
		["https://github.com/foo/bar", "bar"],
		["git@github.com:foo/bar.git", "bar"],
		["ssh://git@example.com/path/repo.git/", "repo"],
		["./local/checkout", "checkout"],
	])("derives %s -> %s", (url, expected) => {
		expect(deriveRepoNameFromUrl(url)).toBe(expected);
	});
});

describe("createGitCloner", () => {
	test("runs git clone and returns the resolved target on success", async () => {
		const calls: string[][] = [];
		const ensureDirCalls: string[] = [];
		const cloner = createGitCloner({
			spawn: async (command) => {
				calls.push(command);
				return { exitCode: 0, stderr: "" };
			},
			ensureDir: (dir) => {
				ensureDirCalls.push(dir);
			},
			exists: () => false,
		});

		await expect(
			cloner({
				remoteUrl: "https://github.com/foo/bar.git",
				parentDir: "/Users/dev/projects",
			}),
		).resolves.toEqual({
			status: "cloned",
			rootCwd: "/Users/dev/projects/bar",
			displayName: "bar",
		});
		expect(ensureDirCalls).toEqual(["/Users/dev/projects"]);
		expect(calls).toEqual([
			[
				"git",
				"clone",
				"https://github.com/foo/bar.git",
				"/Users/dev/projects/bar",
			],
		]);
	});

	test("uses an explicit displayName when provided", async () => {
		const cloner = createGitCloner({
			spawn: async () => ({ exitCode: 0, stderr: "" }),
			ensureDir: () => {},
			exists: () => false,
		});

		await expect(
			cloner({
				remoteUrl: "https://github.com/foo/bar.git",
				parentDir: "/repos",
				displayName: "renamed",
			}),
		).resolves.toEqual({
			status: "cloned",
			rootCwd: "/repos/renamed",
			displayName: "renamed",
		});
	});

	test("fails when the remote URL is empty", async () => {
		const cloner = createGitCloner({
			spawn: async () => ({ exitCode: 0, stderr: "" }),
		});
		await expect(
			cloner({ remoteUrl: "   ", parentDir: "/repos" }),
		).resolves.toEqual({
			status: "failed",
			message: "Remote URL is required",
		});
	});

	test("fails when the parent directory is not absolute", async () => {
		const cloner = createGitCloner({
			spawn: async () => ({ exitCode: 0, stderr: "" }),
		});
		await expect(
			cloner({ remoteUrl: "https://example.com/x.git", parentDir: "rel/path" }),
		).resolves.toEqual({
			status: "failed",
			message: "Parent directory must be an absolute path",
		});
	});

	test("fails when the target directory already exists", async () => {
		const cloner = createGitCloner({
			spawn: async () => ({ exitCode: 0, stderr: "" }),
			ensureDir: () => {},
			exists: (path) => path === "/repos/bar",
		});
		await expect(
			cloner({
				remoteUrl: "https://github.com/foo/bar.git",
				parentDir: "/repos",
			}),
		).resolves.toEqual({
			status: "failed",
			message: "Target directory already exists: /repos/bar",
		});
	});

	test("returns git stderr when the clone command fails", async () => {
		const cloner = createGitCloner({
			spawn: async () => ({
				exitCode: 128,
				stderr: "fatal: repository not found\n",
			}),
			ensureDir: () => {},
			exists: () => false,
		});
		await expect(
			cloner({
				remoteUrl: "https://github.com/foo/missing.git",
				parentDir: "/repos",
			}),
		).resolves.toEqual({
			status: "failed",
			message: "fatal: repository not found",
		});
	});

	test("reports a generic failure when git cannot be launched", async () => {
		const cloner = createGitCloner({
			spawn: async () => {
				throw new Error("git: command not found");
			},
			ensureDir: () => {},
			exists: () => false,
		});
		await expect(
			cloner({
				remoteUrl: "https://github.com/foo/bar.git",
				parentDir: "/repos",
			}),
		).resolves.toEqual({
			status: "failed",
			message: "Failed to launch git: git: command not found",
		});
	});
});
