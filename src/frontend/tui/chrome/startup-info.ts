import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME_DIR = join(homedir(), ".outclaw");

const EXPECTED_FILES = [
	"AGENTS.md",
	"SOUL.md",
	"USER.md",
	"MEMORY.md",
	"HEARTBEAT.md",
	"config.json",
] as const;

export interface GitInfo {
	branch: string;
	dirty: boolean;
	summary: string;
	files: string[];
}

export interface StartupInfo {
	git: GitInfo | null;
	missingFiles: string[];
}

function getGitInfo(): GitInfo | null {
	try {
		const branch = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
			cwd: HOME_DIR,
			stdout: "pipe",
			stderr: "pipe",
		});
		if (branch.exitCode !== 0) return null;

		const branchName = branch.stdout.toString().trim();

		const status = Bun.spawnSync(["git", "status", "--porcelain"], {
			cwd: HOME_DIR,
			stdout: "pipe",
			stderr: "pipe",
		});

		const output = status.stdout.toString().trim();
		const lines = output ? output.split("\n") : [];
		const dirty = lines.length > 0;
		const files = lines.map((l) => l.slice(3));

		return {
			branch: branchName,
			dirty,
			summary: dirty ? `${lines.length} changed` : "clean",
			files,
		};
	} catch {
		return null;
	}
}

function checkWorkingFiles(): string[] {
	return EXPECTED_FILES.filter((f) => !existsSync(join(HOME_DIR, f)));
}

export function collectStartupInfo(): StartupInfo {
	return {
		git: getGitInfo(),
		missingFiles: checkWorkingFiles(),
	};
}
