import type { BrowserTreeEntry } from "../../../../common/protocol.ts";

export function browserTreeEntriesEqual(
	left: BrowserTreeEntry[],
	right: BrowserTreeEntry[],
): boolean {
	return (
		left.length === right.length &&
		left.every((entry, index) => {
			const other = right[index];
			return other !== undefined && browserTreeEntryEqual(entry, other);
		})
	);
}

export function shouldShowTreeLoading({
	entries,
	loading,
}: {
	entries: BrowserTreeEntry[];
	loading: boolean;
}): boolean {
	return loading && entries.length === 0;
}

export function resolveTreeRefreshFailure({
	currentTree,
	errorMessage,
}: {
	currentTree: BrowserTreeEntry[];
	errorMessage: string;
}): { tree: BrowserTreeEntry[]; treeError: string | null } {
	if (currentTree.length > 0) {
		return { tree: currentTree, treeError: null };
	}
	return { tree: [], treeError: errorMessage };
}

function browserTreeEntryEqual(
	left: BrowserTreeEntry,
	right: BrowserTreeEntry,
): boolean {
	return (
		left.kind === right.kind &&
		left.name === right.name &&
		left.path === right.path &&
		left.gitStatus === right.gitStatus &&
		optionalBrowserTreeEntriesEqual(left.children, right.children)
	);
}

function optionalBrowserTreeEntriesEqual(
	left: BrowserTreeEntry[] | undefined,
	right: BrowserTreeEntry[] | undefined,
): boolean {
	if (!left || !right) {
		return left === right;
	}
	return browserTreeEntriesEqual(left, right);
}
