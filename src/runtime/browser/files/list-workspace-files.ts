import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { WorkspaceFileEntry } from "../../../common/protocol.ts";
import { toRelativePath } from "../paths/path-safety.ts";

export const DEFAULT_WORKSPACE_FILE_LIMIT = 2000;

const IGNORED_NAMES = new Set([
	".git",
	".DS_Store",
	".obsidian",
	".claude",
	".agents",
	".agent-id",
	".gitkeep",
	".cache",
	".next",
	".turbo",
	"build",
	"coverage",
	"dist",
	"node_modules",
]);

interface ListWorkspaceFilesOptions {
	limit?: number;
}

export async function listWorkspaceFiles(
	rootDir: string,
	options: ListWorkspaceFilesOptions = {},
): Promise<WorkspaceFileEntry[]> {
	const entries: WorkspaceFileEntry[] = [];
	const limit = normalizeLimit(options.limit);
	await walkDirectory(rootDir, rootDir, entries, limit);
	entries.sort((left, right) => left.path.localeCompare(right.path));
	return entries;
}

async function walkDirectory(
	rootDir: string,
	currentDir: string,
	collector: WorkspaceFileEntry[],
	limit: number,
): Promise<void> {
	if (collector.length >= limit) {
		return;
	}
	const dirents = (await readdir(currentDir, { withFileTypes: true })).sort(
		(left, right) => left.name.localeCompare(right.name),
	);
	for (const dirent of dirents) {
		if (collector.length >= limit) {
			return;
		}
		if (IGNORED_NAMES.has(dirent.name)) {
			continue;
		}

		const absolutePath = resolve(currentDir, dirent.name);
		const path = toRelativePath(rootDir, absolutePath);
		if (dirent.isDirectory()) {
			collector.push({ kind: "directory", path });
			await walkDirectory(rootDir, absolutePath, collector, limit);
			continue;
		}
		if (dirent.isFile()) {
			collector.push({ kind: "file", path });
		}
	}
}

function normalizeLimit(limit: number | undefined): number {
	if (limit === undefined) {
		return DEFAULT_WORKSPACE_FILE_LIMIT;
	}
	if (!Number.isFinite(limit)) {
		return DEFAULT_WORKSPACE_FILE_LIMIT;
	}
	return Math.max(0, Math.floor(limit));
}
