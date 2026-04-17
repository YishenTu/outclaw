import { parsePatch } from "diff";

export type GitDiffFileStatus = "added" | "deleted" | "modified" | "renamed";
export type GitDiffLineKind = "addition" | "context" | "deletion" | "meta";

export interface ParsedGitDiffLine {
	key: string;
	kind: GitDiffLineKind;
	content: string;
	marker: string;
	oldLineNumber: number | null;
	newLineNumber: number | null;
}

export interface ParsedGitDiffHunk {
	key: string;
	lines: ParsedGitDiffLine[];
}

export interface ParsedGitDiffFile {
	key: string;
	displayPath: string;
	oldPath: string;
	newPath: string;
	status: GitDiffFileStatus;
	additions: number;
	deletions: number;
	hunks: ParsedGitDiffHunk[];
}

function trimGitPrefix(path: string | undefined): string {
	if (!path) {
		return "";
	}
	if (path === "/dev/null") {
		return path;
	}
	return path.replace(/^[ab]\//, "");
}

function resolveStatus(oldPath: string, newPath: string): GitDiffFileStatus {
	if (oldPath === "/dev/null") {
		return "added";
	}
	if (newPath === "/dev/null") {
		return "deleted";
	}
	if (oldPath !== newPath) {
		return "renamed";
	}
	return "modified";
}

export function parseGitDiff(diffText: string, fallbackPath: string) {
	return parsePatch(diffText)
		.map((patch, index) => {
			const oldPath = trimGitPrefix(patch.oldFileName);
			const newPath = trimGitPrefix(patch.newFileName);
			const status = resolveStatus(oldPath, newPath);
			const displayPath =
				newPath === "/dev/null"
					? oldPath || fallbackPath
					: newPath || oldPath || fallbackPath;

			let additions = 0;
			let deletions = 0;
			const hunks = patch.hunks.map((hunk) => {
				let oldLineNumber = hunk.oldStart;
				let newLineNumber = hunk.newStart;
				let lineSequence = 0;
				const hunkKey = `${displayPath}:${hunk.oldStart}:${hunk.newStart}`;

				return {
					key: hunkKey,
					lines: hunk.lines.map((line) => {
						const lineKey = `${hunkKey}:${lineSequence}`;
						lineSequence += 1;

						if (line.startsWith("\\")) {
							return {
								key: lineKey,
								kind: "meta",
								content: line,
								marker: "",
								oldLineNumber: null,
								newLineNumber: null,
							} satisfies ParsedGitDiffLine;
						}

						const marker = line[0] ?? " ";
						const content = line.slice(1);

						if (marker === "+") {
							const parsedLine = {
								key: lineKey,
								kind: "addition",
								content,
								marker,
								oldLineNumber: null,
								newLineNumber,
							} satisfies ParsedGitDiffLine;
							newLineNumber += 1;
							additions += 1;
							return parsedLine;
						}

						if (marker === "-") {
							const parsedLine = {
								key: lineKey,
								kind: "deletion",
								content,
								marker,
								oldLineNumber,
								newLineNumber: null,
							} satisfies ParsedGitDiffLine;
							oldLineNumber += 1;
							deletions += 1;
							return parsedLine;
						}

						const parsedLine = {
							key: lineKey,
							kind: "context",
							content,
							marker: " ",
							oldLineNumber,
							newLineNumber,
						} satisfies ParsedGitDiffLine;
						oldLineNumber += 1;
						newLineNumber += 1;
						return parsedLine;
					}),
				} satisfies ParsedGitDiffHunk;
			});

			return {
				key: `${displayPath}:${index}`,
				displayPath,
				oldPath,
				newPath,
				status,
				additions,
				deletions,
				hunks,
			} satisfies ParsedGitDiffFile;
		})
		.filter((file) => file.hunks.length > 0);
}
