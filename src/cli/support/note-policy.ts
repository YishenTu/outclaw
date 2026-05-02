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
	sessionId: string;
	memoryRoot: string;
	now?: Date;
}

export function appendDailyMemoryNote(
	options: AppendDailyMemoryNoteOptions,
): void {
	const salience = resolveSalience(options.salience);
	const content = normalizeContent(options.content);
	if (content.length === 0) {
		throw new Error("oc note: content is empty");
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
			salience,
			content,
			now,
		});
		writeFileSync(dailyPath, next);
	});
}

function resolveSalience(value: string | undefined): Salience {
	if (value === undefined) return DEFAULT_SALIENCE;
	if ((ALLOWED_SALIENCE as readonly string[]).includes(value)) {
		return value as Salience;
	}
	throw new Error(
		`oc note: unknown salience "${value}" (expected one of: ${ALLOWED_SALIENCE.join(" | ")})`,
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
): string {
	const time = formatTime(now);
	const hintSegment = hint ? ` [[${hint}]]` : "";
	const { head, continuation } = splitBody(content);
	const bulletLine = `- ${time} [${salience}] ${head}${hintSegment}`;
	return continuation.length > 0
		? `${bulletLine}\n${continuation}`
		: bulletLine;
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

function withFileLock<T>(targetPath: string, body: () => T): T {
	const lockPath = `${targetPath}.lock`;
	const deadline = Date.now() + LOCK_TIMEOUT_MS;
	let fd: number | undefined;

	while (fd === undefined) {
		try {
			fd = openSync(lockPath, "wx");
		} catch (error) {
			const code = (error as NodeJS.ErrnoException | undefined)?.code;
			if (code !== "EEXIST") throw error;
			breakStaleLock(lockPath);
			if (Date.now() > deadline) {
				throw new Error(`oc note: timed out waiting for lock on ${targetPath}`);
			}
			Bun.sleepSync(LOCK_RETRY_MS);
		}
	}

	try {
		return body();
	} finally {
		closeSync(fd);
		try {
			unlinkSync(lockPath);
		} catch {
			// best-effort
		}
	}
}

function breakStaleLock(lockPath: string): void {
	try {
		const stat = Bun.file(lockPath);
		const lastModified = stat.lastModified;
		if (
			Number.isFinite(lastModified) &&
			Date.now() - lastModified > LOCK_STALE_MS
		) {
			unlinkSync(lockPath);
		}
	} catch {
		// if stat fails, leave it — next retry will try again
	}
}
