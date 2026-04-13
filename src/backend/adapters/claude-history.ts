import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
	DisplayChatMessage,
	DisplayImage,
	DisplayMessage,
	DisplaySystemMessage,
	ImageMediaType,
} from "../../common/protocol.ts";
import { extractError } from "../../common/protocol.ts";
import { parsePromptWithReplyContext } from "../../common/reply-context.ts";

interface HistoryBlock {
	type: string;
	source?: {
		media_type?: ImageMediaType;
	};
	text?: string;
	thinking?: string;
}

export interface ClaudeHistoryMessage {
	type: string;
	message?: unknown;
	subtype?: string;
	compactMetadata?: {
		trigger?: string;
		preTokens?: number;
	};
	compact_metadata?: {
		trigger?: string;
		pre_tokens?: number;
	};
	isMeta?: boolean;
	isCompactSummary?: boolean;
	isVisibleInTranscriptOnly?: boolean;
	isSidechain?: boolean;
	teamName?: string;
}

export type LoadClaudeHistory = (
	sdkSessionId: string,
	options?: { includeSystemMessages?: boolean },
) => Promise<ClaudeHistoryMessage[]>;

interface ReadClaudeHistoryOptions {
	sessionId: string;
	loadHistory: LoadClaudeHistory;
	claudeProjectsDir?: string;
}

export async function readClaudeHistory(
	options: ReadClaudeHistoryOptions,
): Promise<DisplayMessage[]> {
	const rawHistory = await loadClaudeRawHistory(
		options.sessionId,
		options.claudeProjectsDir,
	);
	if (rawHistory !== undefined) {
		return normalizeClaudeHistory(rawHistory);
	}

	const messages = await options.loadHistory(options.sessionId, {
		includeSystemMessages: true,
	});
	return normalizeClaudeHistory(messages);
}

export function normalizeClaudeHistory(
	messages: ClaudeHistoryMessage[],
): DisplayMessage[] {
	const result: DisplayMessage[] = [];
	let pendingThinking = "";

	for (let index = 0; index < messages.length; index++) {
		const msg = messages[index];
		if (!msg) {
			continue;
		}
		if (msg.isMeta || msg.isSidechain || msg.teamName) {
			continue;
		}

		if (msg.type === "system") {
			const entry = extractCompactBoundary(msg, messages[index + 1]);
			if (entry) {
				result.push(entry);
			}
			continue;
		}

		const content = getContent(msg.message);
		if (content === undefined) {
			continue;
		}

		if (
			pendingThinking &&
			msg.type === "user" &&
			isDisplayableUserContent(content)
		) {
			result.push({
				kind: "chat",
				role: "assistant",
				content: "",
				thinking: pendingThinking,
			});
			pendingThinking = "";
		}

		if (msg.type === "user" && isCompactionCommand(content)) {
			continue;
		}

		if (msg.type === "user" && isCompactSummaryMessage(msg, content)) {
			pushCompactBoundary(result);
			continue;
		}

		if (msg.type === "user" && typeof content === "string") {
			const parsed = parsePromptWithReplyContext(content);
			result.push({
				kind: "chat",
				role: "user",
				content: parsed.prompt,
				replyContext: parsed.replyContext,
			});
		}

		if (msg.type === "user" && Array.isArray(content)) {
			const parsed = parsePromptWithReplyContext(extractText(content));
			const images = extractImages(content);
			if (parsed.prompt || parsed.replyContext || images.length > 0) {
				result.push({
					kind: "chat",
					role: "user",
					content: parsed.prompt,
					images: images.length > 0 ? images : undefined,
					replyContext: parsed.replyContext,
				});
			}
		}

		if (msg.type === "assistant" && Array.isArray(content)) {
			const text = extractText(content);
			const thinking = extractThinking(content);
			if (isSyntheticNoResponseReply(text, msg, messages, index)) {
				pendingThinking = "";
				continue;
			}

			if (thinking && !text) {
				pendingThinking += thinking;
				continue;
			}

			if (text) {
				const merged = [pendingThinking, thinking].join("") || undefined;
				pendingThinking = "";
				const entry: DisplayChatMessage = {
					kind: "chat",
					role: "assistant",
					content: text,
				};
				if (merged) {
					entry.thinking = merged;
				}
				result.push(entry);
			}
		}
	}

	if (pendingThinking) {
		result.push({
			kind: "chat",
			role: "assistant",
			content: "",
			thinking: pendingThinking,
		});
	}

	return result;
}

function extractCompactBoundary(
	message: ClaudeHistoryMessage,
	nextMessage: ClaudeHistoryMessage | undefined,
): DisplaySystemMessage | undefined {
	const subtype = getCompactBoundarySubtype(message);
	if (subtype !== "compact_boundary" && !isCompactSummaryMessage(nextMessage)) {
		return undefined;
	}

	const metadata = getCompactMetadata(message);
	return createCompactBoundaryMessage(metadata);
}

function createCompactBoundaryMessage(metadata: {
	trigger?: string;
	preTokens?: number;
}): DisplaySystemMessage {
	return {
		kind: "system",
		event: "compact_boundary",
		text: "context compacted",
		trigger: metadata.trigger === "manual" ? "manual" : "auto",
		preTokens: metadata.preTokens ?? 0,
	};
}

function pushCompactBoundary(result: DisplayMessage[]): void {
	const lastMessage = result.at(-1);
	if (
		lastMessage?.kind === "system" &&
		lastMessage.event === "compact_boundary"
	) {
		return;
	}

	result.push(createCompactBoundaryMessage({}));
}

function getCompactBoundarySubtype(
	message: ClaudeHistoryMessage,
): string | undefined {
	const nested = asRecord(message.message);
	if (typeof nested?.subtype === "string") {
		return nested.subtype;
	}

	return message.subtype;
}

function getCompactMetadata(message: ClaudeHistoryMessage): {
	trigger?: string;
	preTokens?: number;
} {
	const nested = asRecord(message.message);
	const nestedMetadata =
		asRecord(nested?.compactMetadata) ?? asRecord(nested?.compact_metadata);
	const topLevelMetadata =
		asRecord(message.compactMetadata) ?? asRecord(message.compact_metadata);
	const metadata = nestedMetadata ?? topLevelMetadata;

	return {
		trigger:
			typeof metadata?.trigger === "string" ? metadata.trigger : undefined,
		preTokens:
			typeof metadata?.preTokens === "number"
				? metadata.preTokens
				: typeof metadata?.pre_tokens === "number"
					? metadata.pre_tokens
					: undefined,
	};
}

function getContent(message: unknown): string | HistoryBlock[] | undefined {
	const record = asRecord(message);
	const content = record?.content;
	if (typeof content === "string" || Array.isArray(content)) {
		return content as string | HistoryBlock[];
	}

	return undefined;
}

function isDisplayableUserContent(content: string | HistoryBlock[]): boolean {
	if (typeof content === "string") {
		return content.length > 0;
	}

	return content.some((block) => block.type !== "tool_result");
}

function isCompactSummaryMessage(
	message: ClaudeHistoryMessage | undefined,
	content?: string | HistoryBlock[],
): boolean {
	if (!message) {
		return false;
	}

	if (message.isCompactSummary === true) {
		return true;
	}

	const resolvedContent = content ?? getContent(message.message);
	return isCompactSummaryContent(resolvedContent);
}

function isCompactSummaryContent(
	content: string | HistoryBlock[] | undefined,
): boolean {
	const text =
		typeof content === "string" ? content : extractText(content ?? []);
	return text.startsWith(
		"This session is being continued from a previous conversation that ran out of context.",
	);
}

function isCompactionCommand(content: string | HistoryBlock[]): boolean {
	const text = typeof content === "string" ? content : extractText(content);
	return (
		text.includes("<command-name>/compact</command-name>") ||
		text.includes("<local-command-stdout>Compacted")
	);
}

function isSyntheticNoResponseReply(
	text: string,
	message: ClaudeHistoryMessage,
	messages: ClaudeHistoryMessage[],
	index: number,
): boolean {
	if (text !== "No response requested.") {
		return false;
	}

	if (isSyntheticAssistantMessage(message)) {
		return true;
	}

	const previousMessage = findPreviousRelevantMessage(messages, index - 1);
	const previousContent = previousMessage
		? getContent(previousMessage.message)
		: undefined;
	if (previousContent && isCompactionCommand(previousContent)) {
		return true;
	}

	return isCompactSummaryMessage(previousMessage, previousContent);
}

function isSyntheticAssistantMessage(message: ClaudeHistoryMessage): boolean {
	const record = asRecord(message.message);
	return record?.model === "<synthetic>";
}

function findPreviousRelevantMessage(
	messages: ClaudeHistoryMessage[],
	startIndex: number,
): ClaudeHistoryMessage | undefined {
	for (let index = startIndex; index >= 0; index--) {
		const message = messages[index];
		if (!message) {
			continue;
		}
		if (message.isMeta || message.isSidechain || message.teamName) {
			continue;
		}
		if (message.type === "system") {
			return message;
		}
		if (getContent(message.message) !== undefined) {
			return message;
		}
	}

	return undefined;
}

function extractImages(blocks: HistoryBlock[]): DisplayImage[] {
	return blocks
		.filter((block) => block.type === "image")
		.map((block) => ({
			mediaType: block.source?.media_type,
		}));
}

function extractText(blocks: HistoryBlock[]): string {
	return blocks
		.filter((block) => block.type === "text" && block.text)
		.map((block) => block.text)
		.join("");
}

function extractThinking(blocks: HistoryBlock[]): string {
	return blocks
		.filter((block) => block.type === "thinking" && block.thinking)
		.map((block) => block.thinking)
		.join("");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}

	return value as Record<string, unknown>;
}

async function loadClaudeRawHistory(
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
