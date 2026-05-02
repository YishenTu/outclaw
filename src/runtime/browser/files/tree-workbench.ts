import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type {
	BrowserTreeEntry,
	BrowserTreeEntryGitStatus,
} from "../../../common/protocol.ts";
import { toRelativePath } from "../paths/path-safety.ts";

const TREE_IGNORED_NAMES = new Set([".git", ".DS_Store"]);

export async function listTreeEntries(
	rootDir: string,
	currentDir: string,
	gitStatuses: ReadonlyMap<string, BrowserTreeEntryGitStatus>,
): Promise<BrowserTreeEntry[]> {
	const entries = await readdir(currentDir, { withFileTypes: true });
	const visibleEntries = entries
		.filter((entry) => !TREE_IGNORED_NAMES.has(entry.name))
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
				const children = await listTreeEntries(
					rootDir,
					absolutePath,
					gitStatuses,
				);
				const gitStatus = aggregateTreeEntryGitStatus(children);
				return {
					children,
					kind: "directory" as const,
					name: entry.name,
					path,
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

function aggregateTreeEntryGitStatus(
	children: BrowserTreeEntry[],
): BrowserTreeEntryGitStatus | undefined {
	if (children.some((child) => child.gitStatus === "new")) {
		return "new";
	}
	if (children.some((child) => child.gitStatus === "modified")) {
		return "modified";
	}
	return undefined;
}
