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
import { isHelpFlag } from "./usage.ts";

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

export interface AppendNoteOptions {
	content: string;
	salience?: string;
	hint?: string;
	sessionId: string;
	memoryRoot: string;
	now?: Date;
}

export function appendNote(options: AppendNoteOptions): void {
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

export async function noteCommand(options: { argv: string[] }): Promise<void> {
	const args = options.argv.slice(3);
	if (args.some((arg) => isHelpFlag(arg))) {
		printNoteUsage();
		process.exit(0);
	}

	let parsed: ParsedArgs;
	try {
		parsed = parseNoteArgs(args);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		console.error(formatNoteUsage());
		process.exit(1);
	}

	// Positional arg takes precedence. Never read stdin when a positional is
	// present — the agent's Bash-tool subprocess inherits an open-but-unpiped
	// stdin that never EOFs, which would hang the for-await read forever.
	const content = parsed.content ?? (await readStdinUtf8());
	if (content === undefined || content.trim().length === 0) {
		console.error("oc note: no content provided");
		console.error(formatNoteUsage());
		process.exit(1);
	}

	const sessionId = process.env.OC_SESSION_ID;
	const memoryRoot = process.env.OC_MEMORY_ROOT;
	if (!sessionId || !memoryRoot) {
		console.error(
			"oc note: must run inside an outclaw-managed agent session (OC_SESSION_ID and OC_MEMORY_ROOT must be set)",
		);
		process.exit(1);
	}

	try {
		appendNote({
			content,
			salience: parsed.salience,
			hint: parsed.hint,
			sessionId,
			memoryRoot,
		});
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
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

/**
 * Split content into a bullet head (first line) and an indented continuation
 * block for the remaining lines. Keeps each observation addressable as one
 * `- ` line while preserving user-authored structure for humans.
 */
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

interface ParsedArgs {
	content: string | undefined;
	salience: string | undefined;
	hint: string | undefined;
}

function parseNoteArgs(args: string[]): ParsedArgs {
	let content: string | undefined;
	let salience: string | undefined;
	let hint: string | undefined;

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index] ?? "";
		if (arg === "--salience") {
			const value = args[index + 1];
			if (!value || value.startsWith("--")) {
				throw new Error("oc note: --salience requires a value");
			}
			salience = value;
			index += 1;
			continue;
		}
		if (arg === "--hint") {
			const value = args[index + 1];
			if (!value || value.startsWith("--")) {
				throw new Error("oc note: --hint requires a value");
			}
			hint = value;
			index += 1;
			continue;
		}
		if (arg.startsWith("--")) {
			throw new Error(`oc note: unknown flag "${arg}"`);
		}
		if (content !== undefined) {
			throw new Error(
				"oc note: only one positional content argument is allowed",
			);
		}
		content = arg;
	}

	return { content, salience, hint };
}

async function readStdinUtf8(): Promise<string | undefined> {
	if (process.stdin.isTTY) return undefined;

	// Safety timeout: stdin inherited from a parent that never closes it would
	// otherwise hang the for-await read forever. 5s is plenty for any legitimate
	// pipe/heredoc to deliver its payload.
	const STDIN_TIMEOUT_MS = 5000;
	const timeoutId = setTimeout(() => {
		process.stdin.destroy();
	}, STDIN_TIMEOUT_MS);

	const chunks: Buffer[] = [];
	try {
		for await (const chunk of process.stdin) {
			chunks.push(chunk as Buffer);
		}
	} catch {
		// destroy() fires "ERR_STREAM_PREMATURE_CLOSE" on timeout — swallow and
		// treat as empty input.
	} finally {
		clearTimeout(timeoutId);
	}

	const text = Buffer.concat(chunks).toString("utf-8");
	return text.length === 0 ? undefined : text;
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

export function formatNoteUsage(): string {
	return [
		'Usage: oc note "<content>" [--salience <tag>] [--hint <schema>]',
		"       oc note --salience <tag> <<'EOF'",
		"       ...multi-line content...",
		"       EOF",
		"",
		"Appends an observation to today's daily memory file, tagged with the current",
		"outclaw session id. Must run inside an outclaw-managed agent session.",
		"",
		"Salience values: correction | confirmation | decision | surprise | routine",
		"  (default: routine)",
		"Hint (optional): a schema name. Recorded as a note-to-self for the routing agent.",
	].join("\n");
}

export function printNoteUsage(): void {
	console.log(formatNoteUsage());
}
