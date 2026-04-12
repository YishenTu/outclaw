import { describe, expect, mock, test } from "bun:test";
import {
	getGitInfo,
	parseGitStatusOutput,
} from "../../../../src/frontend/tui/chrome/git-info.ts";

describe("parseGitStatusOutput", () => {
	test("preserves the first tracked file path when git prefixes it with a leading space", () => {
		const status = parseGitStatusOutput(
			" M AGENTS.md\n?? daily-memories/2026-04-12.md\n",
		);

		expect(status).toEqual({
			dirty: true,
			summary: "2 changed",
			files: ["AGENTS.md", "daily-memories/2026-04-12.md"],
		});
	});
});

describe("getGitInfo", () => {
	test("requests fully expanded untracked file paths from git status", () => {
		const spawnSync = mock((args: string[]) => {
			if (args[1] === "rev-parse") {
				return {
					exitCode: 0,
					stdout: Buffer.from("main\n"),
					stderr: Buffer.from(""),
				};
			}

			if (args[1] === "status") {
				return {
					exitCode: 0,
					stdout: Buffer.from("?? files/2026/04/07/d3b2f166.jpg\n"),
					stderr: Buffer.from(""),
				};
			}

			throw new Error(`Unexpected git args: ${args.join(" ")}`);
		});

		const gitInfo = getGitInfo(
			spawnSync as unknown as typeof Bun.spawnSync,
			"/tmp/.outclaw",
		);

		expect(spawnSync.mock.calls[1]?.[0]).toEqual([
			"git",
			"status",
			"--porcelain",
			"--untracked-files=all",
		]);
		expect(gitInfo).toEqual({
			branch: "main",
			dirty: true,
			summary: "1 changed",
			files: ["files/2026/04/07/d3b2f166.jpg"],
		});
	});
});
