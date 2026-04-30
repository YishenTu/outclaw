import {
	type AppendDailyMemoryNoteOptions,
	appendDailyMemoryNote,
} from "./note-policy.ts";
import { isHelpFlag } from "./usage.ts";

export interface AppendNoteOptions extends AppendDailyMemoryNoteOptions {}

export function appendNote(options: AppendNoteOptions): void {
	appendDailyMemoryNote(options);
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
