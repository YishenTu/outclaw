export type FileLineStatus = {
	added: Set<number>;
	modified: Set<number>;
	deletedBefore: Set<number>;
};

type ChangeRun = {
	addedLines: number[];
	deletionCount: number;
};

const HUNK_HEADER_PATTERN = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function createEmptyStatus(): FileLineStatus {
	return {
		added: new Set(),
		modified: new Set(),
		deletedBefore: new Set(),
	};
}

function parseNewFilePath(line: string): string | null {
	const newFilePrefix = "+++ b/";
	if (!line.startsWith(newFilePrefix)) {
		return null;
	}
	return line.slice(newFilePrefix.length);
}

export function parseFileLineStatus(
	unifiedDiff: string,
	path: string,
): FileLineStatus {
	const status = createEmptyStatus();
	let currentLine = 0;
	let matchingSection = false;
	let inHunk = false;
	let currentRun: ChangeRun | null = null;

	const flushRun = () => {
		if (!currentRun) {
			return;
		}

		if (currentRun.deletionCount > 0 && currentRun.addedLines.length > 0) {
			for (const lineNumber of currentRun.addedLines) {
				status.modified.add(lineNumber);
			}
		} else if (currentRun.addedLines.length > 0) {
			for (const lineNumber of currentRun.addedLines) {
				status.added.add(lineNumber);
			}
		} else if (currentRun.deletionCount > 0) {
			status.deletedBefore.add(currentLine);
		}

		currentRun = null;
	};

	for (const line of unifiedDiff.split(/\r?\n/)) {
		if (line.startsWith("diff --git ")) {
			flushRun();
			matchingSection = false;
			inHunk = false;
			currentLine = 0;
			continue;
		}

		if (line.startsWith("+++ ")) {
			flushRun();
			const newFilePath = parseNewFilePath(line);
			// Match either an exact relative path (the common `git diff HEAD --
			// <path>` case) or a path that ends with `/<path>` (the new-file
			// fallback `git diff --no-index /dev/null <absolute-path>`, where the
			// `+++ b/` line carries the absolute path).
			matchingSection =
				newFilePath !== null &&
				(newFilePath === path || newFilePath.endsWith(`/${path}`));
			inHunk = false;
			continue;
		}

		if (!matchingSection) {
			continue;
		}

		const hunkHeader = line.match(HUNK_HEADER_PATTERN);
		if (hunkHeader) {
			flushRun();
			currentLine = Number(hunkHeader[1]);
			inHunk = true;
			continue;
		}

		if (!inHunk || line.startsWith("\\")) {
			continue;
		}

		const prefix = line[0];
		if (prefix === "+") {
			currentRun ??= { addedLines: [], deletionCount: 0 };
			currentRun.addedLines.push(currentLine);
			currentLine += 1;
			continue;
		}

		if (prefix === "-") {
			currentRun ??= { addedLines: [], deletionCount: 0 };
			currentRun.deletionCount += 1;
			continue;
		}

		if (prefix === " ") {
			flushRun();
			currentLine += 1;
		}
	}

	flushRun();
	return status;
}
