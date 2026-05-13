import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type {
	BrowserTreeEntry,
	BrowserTreeEntryGitStatus,
} from "../../../common/protocol.ts";
import { toRelativePath } from "../paths/path-safety.ts";
import { REPOSITORY_WORKSPACE_IGNORED_NAMES } from "./list-workspace-files.ts";

const TREE_IGNORED_NAMES = new Set([".git", ".DS_Store"]);

interface ListTreeEntriesOptions {
	ignoredNames?: ReadonlySet<string>;
	maxDepth?: number;
}

export async function listTreeEntries(
	rootDir: string,
	currentDir: string,
	gitStatuses: ReadonlyMap<string, BrowserTreeEntryGitStatus>,
	options: ListTreeEntriesOptions = {},
): Promise<BrowserTreeEntry[]> {
	const entries = await readdir(currentDir, { withFileTypes: true });
	const ignoredNames = options.ignoredNames ?? TREE_IGNORED_NAMES;
	const visibleEntries = entries
		.filter((entry) => !ignoredNames.has(entry.name))
		.sort((left, right) => {
			if (left.isDirectory() && !right.isDirectory()) {
				return -1;
			}
			if (!left.isDirectory() && right.isDirectory()) {
				return 1;
			}
			return left.name.localeCompare(right.name);
		});

	return await Promise.all(
		visibleEntries.map(async (entry) => {
			const absolutePath = resolve(currentDir, entry.name);
			const path = toRelativePath(rootDir, absolutePath);
			if (entry.isDirectory()) {
				const children =
					options.maxDepth === 1
						? undefined
						: await listTreeEntries(rootDir, absolutePath, gitStatuses, {
								...options,
								...(options.maxDepth !== undefined
									? { maxDepth: options.maxDepth - 1 }
									: {}),
							});
				const gitStatus =
					children === undefined
						? aggregateTreeEntryGitStatusFromPaths(path, gitStatuses)
						: aggregateTreeEntryGitStatus(children);
				return {
					kind: "directory" as const,
					name: entry.name,
					path,
					...(children ? { children } : {}),
					...(gitStatus ? { gitStatus } : {}),
				};
			}

			const gitStatus = gitStatuses.get(path);
			return {
				kind: "file" as const,
				name: entry.name,
				path,
				...(gitStatus ? { gitStatus } : {}),
			};
		}),
	);
}

export async function listRepositoryTreeEntries(
	rootDir: string,
	currentDir: string,
	gitStatuses: ReadonlyMap<string, BrowserTreeEntryGitStatus>,
	options: Omit<ListTreeEntriesOptions, "ignoredNames"> = {},
): Promise<BrowserTreeEntry[]> {
	return await listTreeEntries(rootDir, currentDir, gitStatuses, {
		...options,
		ignoredNames: REPOSITORY_WORKSPACE_IGNORED_NAMES,
	});
}

function aggregateTreeEntryGitStatus(
	children: BrowserTreeEntry[] | undefined,
): BrowserTreeEntryGitStatus | undefined {
	if (!children) {
		return undefined;
	}
	if (children.some((child) => child.gitStatus === "new")) {
		return "new";
	}
	if (children.some((child) => child.gitStatus === "modified")) {
		return "modified";
	}
	return undefined;
}

function aggregateTreeEntryGitStatusFromPaths(
	path: string,
	gitStatuses: ReadonlyMap<string, BrowserTreeEntryGitStatus>,
): BrowserTreeEntryGitStatus | undefined {
	let modified = false;
	const prefix = `${path}/`;
	for (const [candidate, status] of gitStatuses) {
		if (candidate !== path && !candidate.startsWith(prefix)) {
			continue;
		}
		if (status === "new") {
			return "new";
		}
		if (status === "modified") {
			modified = true;
		}
	}
	return modified ? "modified" : undefined;
}
