import type { WorkspaceFileEntry } from "./protocol.ts";

export interface MentionToken {
	start: number;
	end: number;
	query: string;
}

export function detectMentionToken(
	value: string,
	cursor: number,
): MentionToken | null {
	const safeCursor = Math.max(0, Math.min(value.length, cursor));
	let active: MentionToken | null = null;
	for (let index = 0; index < safeCursor; index += 1) {
		if (value[index] !== "@") {
			continue;
		}
		const token = detectMentionTokenAt(value, index, safeCursor);
		if (token) {
			active = token;
		}
	}
	return active;
}

export function replaceMentionToken(
	value: string,
	token: MentionToken,
	path: string,
): { value: string; cursor: number } {
	const nextChar = value[token.end];
	const trailingSpace =
		nextChar !== undefined && /\s/.test(nextChar) ? "" : " ";
	const insert = `${formatMentionPath(path)}${trailingSpace}`;
	const next = `${value.slice(0, token.start)}${insert}${value.slice(token.end)}`;
	return {
		value: next,
		cursor: token.start + insert.length,
	};
}

function detectMentionTokenAt(
	value: string,
	start: number,
	cursor: number,
): MentionToken | null {
	const before = start > 0 ? value[start - 1] : undefined;
	if (before !== undefined && !/\s/.test(before)) {
		return null;
	}

	if (value[start + 1] === '"') {
		return detectQuotedMentionToken(value, start, cursor);
	}

	for (let index = start + 1; index < cursor; index += 1) {
		const char = value[index];
		if (char === undefined || /\s/.test(char) || char === '"') {
			return null;
		}
	}

	return {
		start,
		end: cursor,
		query: value.slice(start + 1, cursor),
	};
}

function detectQuotedMentionToken(
	value: string,
	start: number,
	cursor: number,
): MentionToken | null {
	const queryStart = start + 2;
	let escaped = false;
	for (let index = queryStart; index < value.length; index += 1) {
		const char = value[index];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (char === "\\") {
			escaped = true;
			continue;
		}
		if (char === '"') {
			return cursor <= index
				? {
						start,
						end: cursor,
						query: unescapeMentionPath(value.slice(queryStart, cursor)),
					}
				: null;
		}
	}

	return {
		start,
		end: cursor,
		query: unescapeMentionPath(value.slice(queryStart, cursor)),
	};
}

function formatMentionPath(path: string): string {
	if (!/[\s"\\]/.test(path)) {
		return `@${path}`;
	}
	return `@"${path.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function unescapeMentionPath(path: string): string {
	return path.replace(/\\(["\\])/g, "$1");
}

interface RankedEntry {
	entry: WorkspaceFileEntry;
	score: number;
	tieBreak: string;
}

export function matchMentionEntries(
	entries: readonly WorkspaceFileEntry[],
	query: string,
	options: { limit?: number } = {},
): WorkspaceFileEntry[] {
	const normalized = query.toLowerCase();
	const limit =
		options.limit === undefined
			? Number.POSITIVE_INFINITY
			: Math.max(0, Math.floor(options.limit));
	if (!normalized) {
		return entries.slice(0, limit);
	}

	const ranked: RankedEntry[] = [];
	for (const entry of entries) {
		const score = scoreEntry(entry.path.toLowerCase(), normalized);
		if (score === Number.POSITIVE_INFINITY) {
			continue;
		}
		ranked.push({ entry, score, tieBreak: entry.path.toLowerCase() });
	}
	ranked.sort((left, right) => {
		if (left.score !== right.score) {
			return left.score - right.score;
		}
		return left.tieBreak.localeCompare(right.tieBreak);
	});
	return ranked.slice(0, limit).map((item) => item.entry);
}

function scoreEntry(path: string, query: string): number {
	const basename = path.includes("/")
		? path.slice(path.lastIndexOf("/") + 1)
		: path;
	if (basename.startsWith(query)) {
		return 0;
	}
	if (path.startsWith(query)) {
		return 1;
	}
	const basenameHit = basename.indexOf(query);
	if (basenameHit !== -1) {
		return 2 + basenameHit / Math.max(basename.length, 1);
	}
	const pathHit = path.indexOf(query);
	if (pathHit !== -1) {
		return 3 + pathHit / Math.max(path.length, 1);
	}
	return Number.POSITIVE_INFINITY;
}
