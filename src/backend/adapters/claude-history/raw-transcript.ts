import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { extractError } from "../../../common/protocol.ts";
import type { ClaudeHistoryMessage } from "./types.ts";

export async function loadClaudeRawHistory(
	sessionId: string,
	claudeProjectsDir: string | undefined,
): Promise<ClaudeHistoryMessage[] | undefined> {
	const transcriptPath = await findClaudeTranscriptPath(
		sessionId,
		claudeProjectsDir,
	);
	if (!transcriptPath) {
		return undefined;
	}

	const content = await readFile(transcriptPath, "utf8");
	return parseClaudeTranscript(content);
}

async function findClaudeTranscriptPath(
	sessionId: string,
	claudeProjectsDir: string | undefined,
): Promise<string | undefined> {
	const projectsDir = claudeProjectsDir ?? defaultClaudeProjectsDir();
	if (!projectsDir) {
		return undefined;
	}

	let entries: Array<{ isDirectory(): boolean; name: string }>;
	try {
		entries = await readdir(projectsDir, { withFileTypes: true });
	} catch {
		return undefined;
	}

	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue;
		}

		const transcriptPath = join(projectsDir, entry.name, `${sessionId}.jsonl`);
		try {
			await access(transcriptPath);
			return transcriptPath;
		} catch {
			// Keep searching; the session may belong to another Claude project dir.
		}
	}

	return undefined;
}

function parseClaudeTranscript(content: string): ClaudeHistoryMessage[] {
	const messages: ClaudeHistoryMessage[] = [];
	const lines = content.split(/\r?\n/);
	let lastContentLineIndex = lines.length - 1;

	while (lastContentLineIndex >= 0) {
		const candidate = lines[lastContentLineIndex];
		if (candidate?.trim()) {
			break;
		}
		lastContentLineIndex -= 1;
	}

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] as string;
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}

		try {
			const parsed = JSON.parse(trimmed);
			if (isClaudeHistoryMessage(parsed)) {
				messages.push(parsed);
			}
		} catch (error) {
			// Claude can leave the final JSONL line incomplete while still appending.
			if (index === lastContentLineIndex) {
				continue;
			}
			throw new Error(
				`Failed to parse Claude transcript line ${index + 1}: ${extractError(error)}`,
			);
		}
	}

	return messages;
}

function defaultClaudeProjectsDir(): string | undefined {
	const homeDir = process.env.HOME;
	if (!homeDir) {
		return undefined;
	}

	return join(homeDir, ".claude", "projects");
}

function isClaudeHistoryMessage(value: unknown): value is ClaudeHistoryMessage {
	return Boolean(
		value &&
			typeof value === "object" &&
			typeof (value as { type?: unknown }).type === "string",
	);
}
