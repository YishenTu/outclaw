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
	return (
		previous.config !== next.config ||
		previous.env !== next.env ||
		!sortedStringArraysEqual(previous.agents, next.agents)
	);
}

function sortedStringArraysEqual(
	left: string[] | null,
	right: string[] | null,
): boolean {
	if (left === right) {
		return true;
	}
	if (left === null || right === null) {
		return false;
	}
	if (left.length !== right.length) {
		return false;
	}
	for (let i = 0; i < left.length; i += 1) {
		if (left[i] !== right[i]) {
			return false;
		}
	}
	return true;
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
