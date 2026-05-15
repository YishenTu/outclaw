import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { WorkspaceFileEntry } from "../../../common/protocol.ts";
import { gitExcludePathspecsForPaths } from "../git/pathspec.ts";
import { toRelativePath } from "../paths/path-safety.ts";

export const DEFAULT_WORKSPACE_FILE_LIMIT = 2000;

const CHAT_WORKSPACE_IGNORED_NAMES = new Set([
	".git",
	".DS_Store",
	".obsidian",
	".claude",
	".codex",
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

export const REPOSITORY_WORKSPACE_IGNORED_NAMES = new Set([
	".git",
	".DS_Store",
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
	return await listWorkspaceFilesWithIgnoredNames(
		rootDir,
		CHAT_WORKSPACE_IGNORED_NAMES,
		options,
	);
}

export async function listRepositoryWorkspaceFiles(
	rootDir: string,
	options: ListWorkspaceFilesOptions = {},
): Promise<WorkspaceFileEntry[]> {
	const gitEntries = listGitIndexedWorkspaceFiles(rootDir, options);
	if (gitEntries) {
		return gitEntries;
	}
	return await listWorkspaceFilesWithIgnoredNames(
		rootDir,
		REPOSITORY_WORKSPACE_IGNORED_NAMES,
		options,
	);
}

async function listWorkspaceFilesWithIgnoredNames(
	rootDir: string,
	ignoredNames: ReadonlySet<string>,
	options: ListWorkspaceFilesOptions,
): Promise<WorkspaceFileEntry[]> {
	const entries: WorkspaceFileEntry[] = [];
	const limit = normalizeLimit(options.limit);
	await walkDirectory(rootDir, rootDir, entries, limit, ignoredNames);
	entries.sort((left, right) => left.path.localeCompare(right.path));
	return entries;
}

async function walkDirectory(
	rootDir: string,
	currentDir: string,
	collector: WorkspaceFileEntry[],
	limit: number,
	ignoredNames: ReadonlySet<string>,
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
		if (ignoredNames.has(dirent.name)) {
			continue;
		}

		const absolutePath = resolve(currentDir, dirent.name);
		const path = toRelativePath(rootDir, absolutePath);
		if (dirent.isDirectory()) {
			collector.push({ kind: "directory", path });
			await walkDirectory(
				rootDir,
				absolutePath,
				collector,
				limit,
				ignoredNames,
			);
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

function listGitIndexedWorkspaceFiles(
	rootDir: string,
	options: ListWorkspaceFilesOptions,
): WorkspaceFileEntry[] | undefined {
	const result = Bun.spawnSync(
		[
			"git",
			"ls-files",
			"--cached",
			"--others",
			"--exclude-standard",
			"-z",
			"--",
			".",
			...gitExcludePathspecsForPaths([...REPOSITORY_WORKSPACE_IGNORED_NAMES]),
		],
		{
			cwd: rootDir,
			stderr: "pipe",
			stdout: "pipe",
		},
	);
	if (result.exitCode !== 0) {
		return undefined;
	}

	const limit = normalizeLimit(options.limit);
	const entriesByPath = new Map<string, WorkspaceFileEntry>();
	for (const rawPath of result.stdout.toString().split("\0")) {
		const path = rawPath;
		if (!path || shouldIgnoreRepositoryPath(path)) {
			continue;
		}
		for (const directoryPath of parentDirectoryPaths(path)) {
			if (entriesByPath.size >= limit) {
				return sortWorkspaceEntries(entriesByPath);
			}
			entriesByPath.set(directoryPath, {
				kind: "directory",
				path: directoryPath,
			});
		}
		if (entriesByPath.size >= limit) {
			return sortWorkspaceEntries(entriesByPath);
		}
		entriesByPath.set(path, { kind: "file", path });
	}

	return sortWorkspaceEntries(entriesByPath);
}

function parentDirectoryPaths(path: string): string[] {
	const segments = path.split("/");
	const directories: string[] = [];
	for (let index = 1; index < segments.length; index += 1) {
		directories.push(segments.slice(0, index).join("/"));
	}
	return directories;
}

function sortWorkspaceEntries(
	entriesByPath: Map<string, WorkspaceFileEntry>,
): WorkspaceFileEntry[] {
	return [...entriesByPath.values()].sort((left, right) =>
		left.path.localeCompare(right.path),
	);
}

export function shouldIgnoreRepositoryPath(path: string): boolean {
	return path
		.split("/")
		.some((segment) => REPOSITORY_WORKSPACE_IGNORED_NAMES.has(segment));
}
