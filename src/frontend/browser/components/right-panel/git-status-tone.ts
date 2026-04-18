import type {
	BrowserGitFileStatus,
	BrowserTreeEntry,
	BrowserTreeEntryGitStatus,
} from "../../../../common/protocol.ts";

type GitToneStatus = BrowserTreeEntryGitStatus | "deleted";

function gitChangeToneClass(
	status: GitToneStatus | undefined,
	fallbackClassName: string,
): string {
	if (status === "new") {
		return "text-success hover:text-success/80";
	}
	if (status === "deleted") {
		return "text-danger hover:text-danger/80";
	}
	if (status === "modified") {
		return "text-brand hover:text-ember";
	}
	return fallbackClassName;
}

export function gitFileChangeStatus(
	file: BrowserGitFileStatus,
): GitToneStatus | undefined {
	if (file.indexStatus === "D" || file.worktreeStatus === "D") {
		return "deleted";
	}
	if (
		file.indexStatus === "?" ||
		file.worktreeStatus === "?" ||
		file.indexStatus === "A" ||
		file.worktreeStatus === "A"
	) {
		return "new";
	}
	if (file.indexStatus !== " " || file.worktreeStatus !== " ") {
		return "modified";
	}
	return undefined;
}

export function gitFileToneClass(file: BrowserGitFileStatus): string {
	return gitChangeToneClass(
		gitFileChangeStatus(file),
		"text-dark-400 hover:text-dark-200",
	);
}

export function treeEntryToneClass(entry: BrowserTreeEntry): string {
	return gitChangeToneClass(
		entry.gitStatus,
		entry.kind === "directory"
			? "text-dark-300 hover:text-dark-100"
			: "text-dark-400 hover:text-dark-200",
	);
}
