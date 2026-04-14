import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type GitInfo, getGitInfo } from "./git-info.ts";

const HOME_DIR = join(homedir(), ".outclaw");

const EXPECTED_AGENT_FILES = [
	".agent-id",
	"AGENTS.md",
	"SOUL.md",
	"USER.md",
	"MEMORY.md",
	"HEARTBEAT.md",
] as const;

export interface StartupInfo {
	git: GitInfo | null;
	missingFiles: string[];
}

interface CollectStartupInfoOptions {
	getGitInfo?: () => GitInfo | null;
	homeDir?: string;
}

function checkWorkingFiles(homeDir: string): string[] {
	const missingFiles: string[] = [];

	if (!existsSync(join(homeDir, "config.json"))) {
		missingFiles.push("config.json");
	}

	const agentsDir = join(homeDir, "agents");
	if (!existsSync(agentsDir)) {
		missingFiles.push("agents/");
		return missingFiles;
	}

	const agentNames = readdirSync(agentsDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort((left, right) => left.localeCompare(right));

	if (agentNames.length === 0) {
		missingFiles.push("agents/");
		return missingFiles;
	}

	for (const agentName of agentNames) {
		for (const filename of EXPECTED_AGENT_FILES) {
			if (!existsSync(join(agentsDir, agentName, filename))) {
				missingFiles.push(`agents/${agentName}/${filename}`);
			}
		}
	}

	return missingFiles.sort((left, right) => left.localeCompare(right));
}

export function collectStartupInfo(
	options: CollectStartupInfoOptions = {},
): StartupInfo {
	const homeDir = options.homeDir ?? HOME_DIR;
	const readGitInfo = options.getGitInfo ?? getGitInfo;

	return {
		git: readGitInfo(),
		missingFiles: checkWorkingFiles(homeDir),
	};
}
