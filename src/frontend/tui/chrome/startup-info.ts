import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type GitInfo, getGitInfo } from "./git-info.ts";

const HOME_DIR = join(homedir(), ".outclaw");

const EXPECTED_FILES = [
	"AGENTS.md",
	"SOUL.md",
	"USER.md",
	"MEMORY.md",
	"HEARTBEAT.md",
	"config.json",
] as const;

export interface StartupInfo {
	git: GitInfo | null;
	missingFiles: string[];
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
