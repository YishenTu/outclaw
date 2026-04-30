import { type Dirent, existsSync, readdirSync, readFileSync } from "node:fs";
import { createOutclawLayout } from "../../common/layout.ts";

export interface RestartRequiredSnapshot {
	agents: string[] | null;
	config: string | null;
	env: string | null;
}

export function readRestartRequiredSnapshot(
	homeDir: string,
): RestartRequiredSnapshot {
	const layout = createOutclawLayout({ homeDir });
	return {
		agents: readAgentsTopology(layout.agentsDir),
		config: readOptionalText(layout.configPath),
		env: readOptionalText(layout.envPath),
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
