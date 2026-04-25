import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	HEARTBEAT_DISPLAY_LABEL,
	isHeartbeatNoopResult,
	isOperationalHeartbeatPrompt,
} from "../../common/heartbeat-prompt.ts";
import type {
	DisplayChatMessage,
	DisplayImage,
	DisplayMessage,
	DisplaySystemMessage,
	ImageMediaType,
	TranscriptTurn,
} from "../../common/protocol.ts";
import { extractError } from "../../common/protocol.ts";
import { parsePromptWithReplyContext } from "../../common/reply-context.ts";
import {
	isOperationalRolloverPrompt,
	ROLLOVER_DISPLAY_LABEL,
} from "../../common/rollover-prompt.ts";

interface HistoryBlock {
	type: string;
	content?: unknown;
	is_error?: boolean;
	source?: {
		data?: string;
		media_type?: ImageMediaType;
	};
	text?: string;
	thinking?: string;
}

export interface ClaudeHistoryMessage {
	type: string;
	timestamp?: string;
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
	toolUseResult?: unknown;
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

export async function readClaudeTranscript(options: {
	sessionId: string;
	loadHistory?: LoadClaudeHistory;
	claudeProjectsDir?: string;
}): Promise<TranscriptTurn[]> {
	const rawHistory = await loadClaudeRawHistory(
		options.sessionId,
		options.claudeProjectsDir,
	);
	if (rawHistory === undefined) {
		if (!options.loadHistory) {
			throw new Error(
				`Claude transcript unavailable for session: ${options.sessionId}`,
			);
		}

		const messages = await options.loadHistory(options.sessionId, {
			includeSystemMessages: true,
		});
		return normalizeClaudeTranscript(messages);
	}

	return normalizeClaudeTranscript(rawHistory);
}

export function normalizeClaudeHistory(
	messages: ClaudeHistoryMessage[],
): DisplayMessage[] {
	const result: DisplayMessage[] = [];
	let pendingThinking = "";
	let pendingThinkingTimestamp: number | undefined;
	let pendingSystemPrompt: "heartbeat" | "rollover" | undefined;

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

		const timestamp = parseDisplayTimestamp(msg);
		const content = getContent(msg.message);
		if (msg.type === "user" && isRequestInterruptionEvent(msg, content)) {
			pendingThinking = "";
			pendingThinkingTimestamp = undefined;
			pendingSystemPrompt = undefined;
			result.push(
				createStatusMessage("Request interrupted by user", timestamp),
			);
			continue;
		}
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
				timestamp: pendingThinkingTimestamp,
			});
			pendingThinking = "";
			pendingThinkingTimestamp = undefined;
		}

		if (msg.type === "user" && isCompactionCommand(content)) {
			continue;
		}

		if (msg.type === "user" && isCompactSummaryMessage(msg, content)) {
			pushCompactBoundary(result);
			continue;
		}

		if (msg.type === "user" && typeof content === "string") {
			const strippedContent = stripTaskNotifications(content);
			const parsed = parsePromptWithReplyContext(strippedContent);
			if (isOperationalHeartbeatTurn(parsed.prompt, parsed.replyContext)) {
				pendingSystemPrompt = "heartbeat";
				continue;
			}
			if (isOperationalRolloverTurn(parsed.prompt, parsed.replyContext)) {
				pendingSystemPrompt = "rollover";
				continue;
			}
			if (parsed.prompt || parsed.replyContext) {
				result.push({
					kind: "chat",
					role: "user",
					content: parsed.prompt,
					replyContext: parsed.replyContext,
					timestamp,
				});
			}
		}

		if (msg.type === "user" && Array.isArray(content)) {
			const strippedText = stripTaskNotifications(extractText(content));
			const parsed = parsePromptWithReplyContext(strippedText);
			const images = extractImages(content);
			if (
				isOperationalHeartbeatTurn(parsed.prompt, parsed.replyContext, images)
			) {
				pendingSystemPrompt = "heartbeat";
				continue;
			}
			if (
				isOperationalRolloverTurn(parsed.prompt, parsed.replyContext, images)
			) {
				pendingSystemPrompt = "rollover";
				continue;
			}
			if (parsed.prompt || parsed.replyContext || images.length > 0) {
				const entry: DisplayChatMessage = {
					kind: "chat",
					role: "user",
					content: parsed.prompt,
					images: images.length > 0 ? images : undefined,
					timestamp,
				};
				if (parsed.replyContext) {
					entry.replyContext = parsed.replyContext;
				}
				result.push(entry);
			}
		}

		if (msg.type === "assistant" && Array.isArray(content)) {
			const text = stripTaskNotifications(extractText(content));
			const thinking = extractThinking(content);
			if (isSyntheticNoResponseReply(text, msg, messages, index)) {
				pendingThinking = "";
				pendingThinkingTimestamp = undefined;
				pendingSystemPrompt = undefined;
				continue;
			}

			if (thinking && !text) {
				pendingThinking += thinking;
				pendingThinkingTimestamp ??= timestamp;
				continue;
			}

			if (text) {
				const merged = [pendingThinking, thinking].join("") || undefined;
				pendingThinking = "";
				pendingThinkingTimestamp = undefined;
				if (pendingSystemPrompt === "heartbeat") {
					pendingSystemPrompt = undefined;
					if (isHeartbeatNoopResult(text)) {
						continue;
					}
					result.push(createHeartbeatMessage());
				} else if (pendingSystemPrompt === "rollover") {
					pendingSystemPrompt = undefined;
					result.push(createRolloverMessage());
				}
				const entry: DisplayChatMessage = {
					kind: "chat",
					role: "assistant",
					content: text,
					timestamp,
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
			timestamp: pendingThinkingTimestamp,
		});
	}

	return result;
}

const TASK_NOTIFICATION_PATTERN =
	/\s*<task-notification>\s*[\s\S]*?\s*<\/task-notification>\s*/g;
const REQUEST_INTERRUPTION_LINE_PATTERN =
	/^(?:\[Request interrupted by user(?: for tool use)?\]|Request interrupted by user)$/;
const REQUEST_INTERRUPTION_FRAGMENT_PATTERN =
	/\[Request interrupted by user(?: for tool use)?\]|Request interrupted by user/;

export function normalizeClaudeTranscript(
	messages: ClaudeHistoryMessage[],
): TranscriptTurn[] {
	const result: TranscriptTurn[] = [];

	for (let index = 0; index < messages.length; index++) {
		const msg = messages[index];
		if (!msg) {
			continue;
		}
		if (
			msg.isMeta ||
			msg.isSidechain ||
			msg.teamName ||
			msg.type === "system"
		) {
			continue;
		}

		const content = getContent(msg.message);
		if (content === undefined) {
			continue;
		}

		if (msg.type === "user") {
			if (
				isRequestInterruptionEvent(msg, content) ||
				isCompactionCommand(content) ||
				isCompactSummaryMessage(msg, content)
			) {
				continue;
			}

			const timestamp = parseTranscriptTimestamp(msg);
			if (typeof content === "string") {
				const parsed = parsePromptWithReplyContext(
					stripTaskNotifications(content),
				);
				if (parsed.prompt || parsed.replyContext) {
					result.push({
						role: "user",
						content: parsed.prompt,
						replyContext: parsed.replyContext,
						source: resolveTranscriptPromptSource(
							parsed.prompt,
							parsed.replyContext,
						),
						timestamp,
					});
				}
				continue;
			}

			const parsed = parsePromptWithReplyContext(
				stripTaskNotifications(extractText(content)),
			);
			const images = extractImages(content, "transcript");
			if (parsed.prompt || parsed.replyContext || images.length > 0) {
				const entry: TranscriptTurn = {
					role: "user",
					content: parsed.prompt,
					images: images.length > 0 ? images : undefined,
					timestamp,
				};
				if (parsed.replyContext) {
					entry.replyContext = parsed.replyContext;
				}
				const source = resolveTranscriptPromptSource(
					parsed.prompt,
					parsed.replyContext,
					images,
				);
				if (source) {
					entry.source = source;
				}
				result.push(entry);
			}
			continue;
		}

		if (msg.type !== "assistant") {
			continue;
		}

		const timestamp = parseTranscriptTimestamp(msg);
		if (typeof content === "string") {
			if (content) {
				result.push({
					role: "assistant",
					content,
					timestamp,
				});
			}
			continue;
		}

		const text = extractText(content);
		if (!text || isSyntheticNoResponseReply(text, msg, messages, index)) {
			continue;
		}

		result.push({
			role: "assistant",
			content: text,
			timestamp,
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

function createHeartbeatMessage(): DisplaySystemMessage {
	return {
		kind: "system",
		event: "heartbeat",
		text: HEARTBEAT_DISPLAY_LABEL,
	};
}

function createRolloverMessage(): DisplaySystemMessage {
	return {
		kind: "system",
		event: "rollover",
		text: ROLLOVER_DISPLAY_LABEL,
	};
}

function createStatusMessage(
	text: string,
	timestamp: number | undefined,
): DisplaySystemMessage {
	return {
		kind: "system",
		event: "status",
		text,
		timestamp,
	};
}

function isRequestInterruptionEvent(
	message: ClaudeHistoryMessage,
	content: string | HistoryBlock[] | undefined,
): boolean {
	if (typeof content === "string") {
		return isRequestInterruptionMarker(stripTaskNotifications(content));
	}

	if (Array.isArray(content)) {
		if (
			isRequestInterruptionMarker(stripTaskNotifications(extractText(content)))
		) {
			return true;
		}

		if (content.some(isRequestInterruptionToolResult)) {
			return true;
		}
	}

	return isInterruptedToolUseResult(message.toolUseResult);
}

function isRequestInterruptionMarker(text: string): boolean {
	const marker = stripToolUseErrorTags(text);
	return marker
		.split(/\r?\n/)
		.some((line) => REQUEST_INTERRUPTION_LINE_PATTERN.test(line.trim()));
}

function isRequestInterruptionToolResult(block: HistoryBlock): boolean {
	return (
		block.type === "tool_result" &&
		block.is_error === true &&
		containsRequestInterruptionMarker(block.content)
	);
}

function isInterruptedToolUseResult(value: unknown): boolean {
	if (containsRequestInterruptionMarker(value)) {
		return true;
	}

	const record = asRecord(value);
	return record?.interrupted === true;
}

function containsRequestInterruptionMarker(value: unknown): boolean {
	if (typeof value !== "string") {
		return false;
	}

	return REQUEST_INTERRUPTION_FRAGMENT_PATTERN.test(
		stripToolUseErrorTags(value),
	);
}

function stripToolUseErrorTags(text: string): string {
	return text
		.trim()
		.replace(/^<tool_use_error>\s*/, "")
		.replace(/\s*<\/tool_use_error>$/, "")
		.trim();
}

function isOperationalHeartbeatTurn(
	prompt: string,
	replyContext?: { text: string },
	images: DisplayImage[] = [],
): boolean {
	return (
		prompt !== "" &&
		replyContext === undefined &&
		images.length === 0 &&
		isOperationalHeartbeatPrompt(prompt)
	);
}

function isOperationalRolloverTurn(
	prompt: string,
	replyContext?: { text: string },
	images: DisplayImage[] = [],
): boolean {
	return (
		prompt !== "" &&
		replyContext === undefined &&
		images.length === 0 &&
		isOperationalRolloverPrompt(prompt)
	);
}

function resolveTranscriptPromptSource(
	prompt: string,
	replyContext?: { text: string },
	images: DisplayImage[] = [],
): "heartbeat" | "rollover" | undefined {
	if (isOperationalHeartbeatTurn(prompt, replyContext, images)) {
		return "heartbeat";
	}
	if (isOperationalRolloverTurn(prompt, replyContext, images)) {
		return "rollover";
	}
	return undefined;
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

function extractImages(
	blocks: HistoryBlock[],
	mode: "history" | "transcript" = "history",
): DisplayImage[] {
	return blocks
		.filter((block) => block.type === "image")
		.flatMap<DisplayImage>((block) => {
			const mediaType = block.source?.media_type;
			if (!mediaType) {
				return [];
			}

			if (mode === "history") {
				const base64 = block.source?.data;
				if (typeof base64 === "string" && base64.length > 0) {
					return [
						{
							kind: "inline" as const,
							mediaType,
							base64,
						},
					];
				}
			}

			return [
				{
					kind: "placeholder" as const,
					mediaType,
				},
			];
		});
}

function extractText(blocks: HistoryBlock[]): string {
	return blocks
		.filter((block) => block.type === "text")
		.map((block) =>
			typeof block.text === "string"
				? block.text
				: typeof block.content === "string"
					? block.content
					: "",
		)
		.join("");
}

function extractThinking(blocks: HistoryBlock[]): string {
	return blocks
		.filter((block) => block.type === "thinking" && block.thinking)
		.map((block) => block.thinking)
		.join("");
}

function stripTaskNotifications(text: string): string {
	if (!text.includes("<task-notification>")) {
		return text;
	}

	return text
		.replace(TASK_NOTIFICATION_PATTERN, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}

	return value as Record<string, unknown>;
}

function parseTranscriptTimestamp(message: ClaudeHistoryMessage): number {
	const timestamp = message.timestamp;
	const parsed = typeof timestamp === "string" ? Date.parse(timestamp) : NaN;
	if (Number.isNaN(parsed)) {
		throw new Error("Claude transcript turn is missing a valid timestamp");
	}
	return parsed;
}

function parseDisplayTimestamp(
	message: ClaudeHistoryMessage,
): number | undefined {
	const timestamp = message.timestamp;
	if (typeof timestamp !== "string") {
		return undefined;
	}

	const parsed = Date.parse(timestamp);
	return Number.isNaN(parsed) ? undefined : parsed;
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
