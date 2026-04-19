import { type Dirent, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface RestartRequiredSnapshot {
	agents: string[] | null;
	config: string | null;
	env: string | null;
}

export function readRestartRequiredSnapshot(
	homeDir: string,
): RestartRequiredSnapshot {
	return {
		agents: readAgentsTopology(join(homeDir, "agents")),
		config: readOptionalText(join(homeDir, "config.json")),
		env: readOptionalText(join(homeDir, ".env")),
	};
}

export function didRestartRequiredSnapshotChange(
	previous: RestartRequiredSnapshot,
	next: RestartRequiredSnapshot,
): boolean {
	return JSON.stringify(previous) !== JSON.stringify(next);
}

function readOptionalText(path: string): string | null {
	if (!existsSync(path)) {
		return null;
	}
	return readFileSync(path, "utf-8");
}

function readAgentsTopology(path: string): string[] | null {
	if (!existsSync(path)) {
		return null;
	}
	return readdirSync(path, { withFileTypes: true })
		.map((entry) => `${direntKind(entry)}:${entry.name}`)
		.sort((left, right) => left.localeCompare(right));
}

function direntKind(entry: Dirent): string {
	if (entry.isDirectory()) {
		return "dir";
	}
	if (entry.isFile()) {
		return "file";
	}
	if (entry.isSymbolicLink()) {
		return "symlink";
	}
	return "other";
}
