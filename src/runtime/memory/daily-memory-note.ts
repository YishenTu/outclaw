import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const ALLOWED_SALIENCE = [
	"correction",
	"confirmation",
	"decision",
	"surprise",
	"routine",
] as const;
type Salience = (typeof ALLOWED_SALIENCE)[number];
const DEFAULT_SALIENCE: Salience = "routine";
const LOCK_RETRY_MS = 5;
const LOCK_TIMEOUT_MS = 5000;
const LOCK_STALE_MS = 30_000;

export interface AppendDailyMemoryNoteOptions {
	content: string;
	salience?: string;
	hint?: string;
	tags?: readonly string[];
	sessionId: string;
	memoryRoot: string;
	now?: Date;
}

export interface AppendDailyMemoryNoteResult {
	path: string;
	timestamp: number;
}

export function appendDailyMemoryNote(
	options: AppendDailyMemoryNoteOptions,
): AppendDailyMemoryNoteResult {
	const salience = resolveSalience(options.salience);
	const content = normalizeContent(options.content);
	if (content.length === 0) {
		throw new Error("memory note: content is empty");
	}

	const now = options.now ?? new Date();
	const dailyPath = resolveDailyPath(options.memoryRoot, now);
	mkdirSync(dirname(dailyPath), { recursive: true });

	withFileLock(dailyPath, () => {
		const existing = existsSync(dailyPath)
			? readFileSync(dailyPath, "utf-8")
			: "";
		const next = buildNextContent({
			existing,
			sessionId: options.sessionId,
			hint: options.hint,
			tags: options.tags,
			salience,
			content,
			now,
		});
		writeFileSync(dailyPath, next);
	});

	return {
		path: dailyPath,
		timestamp: now.getTime(),
	};
}

function resolveSalience(value: string | undefined): Salience {
	if (value === undefined) return DEFAULT_SALIENCE;
	if ((ALLOWED_SALIENCE as readonly string[]).includes(value)) {
		return value as Salience;
	}
	throw new Error(
		`memory note: unknown salience "${value}" (expected one of: ${ALLOWED_SALIENCE.join(" | ")})`,
	);
}

function normalizeContent(content: string): string {
	return content.replace(/\s+$/g, "").replace(/^[ \t]+/g, "");
}

interface SplitBody {
	head: string;
	continuation: string;
}

function splitBody(content: string): SplitBody {
	const lines = content.split(/\r?\n/);
	if (lines.length <= 1) {
		return { head: content, continuation: "" };
	}
	const [first, ...rest] = lines;
	const indented = rest
		.map((line) => (line.length === 0 ? "" : `  ${line.trimStart()}`))
		.join("\n");
	return { head: first ?? "", continuation: indented };
}

function resolveDailyPath(memoryRoot: string, now: Date): string {
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return join(memoryRoot, "daily-memories", `${year}-${month}-${day}.md`);
}

interface BuildNextContentOptions {
	existing: string;
	sessionId: string;
	hint: string | undefined;
	tags: readonly string[] | undefined;
	salience: Salience;
	content: string;
	now: Date;
}

function buildNextContent(options: BuildNextContentOptions): string {
	const stanzaHeader = formatStanzaHeader(options.sessionId, options.now);
	const entry = formatEntry(
		options.now,
		options.salience,
		options.content,
		options.hint,
		options.tags,
	);
	const title = `# ${formatDate(options.now)}\n`;

	if (options.existing.length === 0) {
		return `${title}\n${stanzaHeader}\n\n${entry}\n`;
	}
	const reconciled = reconcileExistingBody(
		options.existing,
		options.sessionId,
		stanzaHeader,
	);
	return `${reconciled}${entry}\n`;
}

function reconcileExistingBody(
	existing: string,
	sessionId: string,
	stanzaHeader: string,
): string {
	const normalized = existing.endsWith("\n") ? existing : `${existing}\n`;
	const lastStanzaSessionId = findLastStanzaSessionId(normalized);
	if (lastStanzaSessionId === sessionId) {
		return normalized;
	}
	const separator = normalized.endsWith("\n\n") ? "" : "\n";
	return `${normalized}${separator}${stanzaHeader}\n\n`;
}

function findLastStanzaSessionId(content: string): string | undefined {
	const matches = [...content.matchAll(/^## Session (\S+) \| /gm)];
	const last = matches.at(-1);
	return last?.[1];
}

function formatStanzaHeader(sessionId: string, now: Date): string {
	return `## Session ${sessionId} | ${formatTime(now)}`;
}

function formatEntry(
	now: Date,
	salience: Salience,
	content: string,
	hint: string | undefined,
	tags: readonly string[] | undefined,
): string {
	const time = formatTime(now);
	const hintSegment = formatHintSegment(hint, tags);
	const { head, continuation } = splitBody(content);
	const bulletLine = `- ${time} [${salience}] ${head}${hintSegment}`;
	return continuation.length > 0
		? `${bulletLine}\n${continuation}`
		: bulletLine;
}

function formatHintSegment(
	hint: string | undefined,
	tags: readonly string[] | undefined,
): string {
	const hints = [
		...(hint === undefined ? [] : [hint]),
		...(tags === undefined ? [] : tags),
	];
	if (hints.length === 0) {
		return "";
	}
	return ` ${hints.map((value) => `[[${value}]]`).join(" ")}`;
}

function formatDate(now: Date): string {
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function formatTime(now: Date): string {
	const hours = String(now.getHours()).padStart(2, "0");
	const minutes = String(now.getMinutes()).padStart(2, "0");
	return `${hours}:${minutes}`;
}

function withFileLock(path: string, fn: () => void): void {
	const lockPath = `${path}.lock`;
	const started = Date.now();

	while (true) {
		try {
			const fd = openSync(lockPath, "wx");
			try {
				fn();
			} finally {
				closeSync(fd);
				try {
					unlinkSync(lockPath);
				} catch {
					// Lock cleanup is best-effort; a later writer can reclaim stale locks.
				}
			}
			return;
		} catch (error) {
			if (!isFileExistsError(error) || Date.now() - started > LOCK_TIMEOUT_MS) {
				throw error;
			}
			reclaimStaleLock(lockPath);
			sleepSync(LOCK_RETRY_MS);
		}
	}
}

function reclaimStaleLock(lockPath: string): void {
	try {
		const age = Date.now() - Bun.file(lockPath).lastModified;
		if (age > LOCK_STALE_MS) {
			unlinkSync(lockPath);
		}
	} catch {
		// The lock may have disappeared between retries.
	}
}

function sleepSync(ms: number): void {
	const end = Date.now() + ms;
	while (Date.now() < end) {}
}

function isFileExistsError(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === "EEXIST"
	);
}
