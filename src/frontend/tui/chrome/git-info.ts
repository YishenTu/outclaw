import { homedir } from "node:os";
import { join } from "node:path";

const HOME_DIR = join(homedir(), ".outclaw");

const GIT_BRANCH_ARGS = ["git", "rev-parse", "--abbrev-ref", "HEAD"];
const GIT_STATUS_ARGS = [
	"git",
	"status",
	"--porcelain",
	"--untracked-files=all",
];

export interface GitInfo {
	branch: string;
	dirty: boolean;
	summary: string;
	files: string[];
}

export function parseGitStatusOutput(
	output: string,
): Pick<GitInfo, "dirty" | "summary" | "files"> {
	const lines = output.split("\n").filter((line) => line.length > 0);
	const files = lines.map((line) => line.slice(3));
	const dirty = files.length > 0;

	return {
		dirty,
		summary: dirty ? `${files.length} changed` : "clean",
		files,
	};
}

export function getGitInfo(
	spawnSync: typeof Bun.spawnSync = Bun.spawnSync,
	cwd = HOME_DIR,
): GitInfo | null {
	try {
		const branch = spawnSync(GIT_BRANCH_ARGS, {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});
		if (branch.exitCode !== 0) {
			return null;
		}

		const status = spawnSync(GIT_STATUS_ARGS, {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});

		return {
			branch: branch.stdout.toString().trim(),
			...parseGitStatusOutput(status.stdout.toString()),
		};
	} catch {
		return null;
	}
}
