import { readFile } from "node:fs/promises";
import { createDisplayCompactBoundaryMessage } from "../../../common/compact-boundary.ts";
import type {
	CodingSessionEvent,
	DisplayChatMessage,
	DisplayMessage,
	TranscriptTurn,
} from "../../../common/protocol.ts";
import { parsePromptWithReplyContext } from "../../../common/reply-context.ts";
import {
	distinctThinkingBlocks,
	ThinkingBlockAccumulator,
} from "../../../common/thinking-blocks.ts";
import { normalizeCodexJsonlEvents } from "./stream-normalizer.ts";
import type { CodexAppServerClient, CodexThreadReadResult } from "./types.ts";

interface CodexChatHistorySource {
	client: CodexAppServerClient;
	sessionId: string;
}

interface CodexLoadedTranscript {
	events: CodingSessionEvent[];
	threadId: string;
}

/**
 * Shared Codex JSONL transcript loader. Both Code Mode (via
 * `readCodingSessionEvents`) and Chat Mode (via the readHistory/readReplay/
 * readTranscript paths below) flow through this loader so the runtime never
 * parses Codex JSONL twice with different rules. Returned events are the
 * Code Mode event projection; chat-specific projection is layered on top.
 */
export async function loadCodexJsonlTranscript(
	source: CodexChatHistorySource,
): Promise<CodexLoadedTranscript> {
	await source.client.initialize();
	const thread = await source.client.request<CodexThreadReadResult>(
		"thread/read",
		{ threadId: source.sessionId, includeTurns: false },
	);
	if (!thread.thread.path) {
		return { events: [], threadId: thread.thread.id };
	}
	const content = await readFile(thread.thread.path, "utf8");
	const events = normalizeCodexJsonlEvents(content, {
		sessionId: thread.thread.id,
	});
	return { events, threadId: thread.thread.id };
}

/**
 * Project Codex transcript events into chat `DisplayMessage[]` for the
 * normal-chat history surface. Filters tool/command/file-change/web-search
 * traces out of the chat view; reasoning text attaches to the assistant
 * message it precedes.
 */
export function projectCodexChatDisplayMessages(
	events: CodingSessionEvent[],
): DisplayMessage[] {
	const messages: DisplayMessage[] = [];
	const pendingThinking = new ThinkingBlockAccumulator();
	let pendingAssistantText = "";
	let pendingAssistantTimestamp: number | undefined;

	const flushAssistant = (timestamp?: number) => {
		const thinking = pendingThinking.snapshot();
		if (pendingAssistantText || thinking.text) {
			const assistantTimestamp = timestamp ?? pendingAssistantTimestamp;
			const thinkingBlocks = distinctThinkingBlocks(thinking);
			const message: DisplayMessage = {
				kind: "chat",
				role: "assistant",
				content: pendingAssistantText,
				...(thinking.text ? { thinking: thinking.text } : {}),
				...(thinkingBlocks ? { thinkingBlocks } : {}),
				...(assistantTimestamp !== undefined
					? { timestamp: assistantTimestamp }
					: {}),
			};
			messages.push(message);
		}
		pendingAssistantText = "";
		pendingThinking.clear();
		pendingAssistantTimestamp = undefined;
	};

	for (const event of events) {
		switch (event.type) {
			case "user_prompt": {
				flushAssistant();
				const parsed = parsePromptWithReplyContext(event.text);
				const images = event.images ?? [];
				if (parsed.prompt || parsed.replyContext || images.length > 0) {
					const message: DisplayChatMessage = {
						kind: "chat",
						role: "user",
						content: parsed.prompt,
						...(images.length > 0 ? { images } : {}),
						...(event.timestamp !== undefined
							? { timestamp: event.timestamp }
							: {}),
					};
					if (parsed.replyContext) {
						message.replyContext = parsed.replyContext;
					}
					messages.push(message);
				}
				break;
			}
			case "text": {
				pendingAssistantText += event.text;
				pendingAssistantTimestamp =
					event.timestamp ?? pendingAssistantTimestamp;
				break;
			}
			case "thinking": {
				pendingThinking.append(event);
				pendingAssistantTimestamp =
					event.timestamp ?? pendingAssistantTimestamp;
				break;
			}
			case "done": {
				flushAssistant(event.timestamp);
				break;
			}
			case "compacting_finished": {
				flushAssistant();
				messages.push(createDisplayCompactBoundaryMessage());
				break;
			}
			default:
				// Tool calls, command execution, file changes, web search,
				// session lifecycle, and unknown events do not appear in chat
				// replay — those belong to the coding-session projection.
				break;
		}
	}
	flushAssistant();
	return messages;
}

/**
 * Project Codex transcript events into `TranscriptTurn[]` for export. Each
 * turn captures the timestamp of the source row. Returns null when the
 * transcript lacks durable timestamps so callers can surface a clear error
 * instead of inventing a `Date.now()` shim.
 */
export function projectCodexChatTranscriptTurns(
	events: CodingSessionEvent[],
): TranscriptTurn[] | null {
	const turns: TranscriptTurn[] = [];
	let assistantText = "";
	let assistantTimestamp: number | undefined;

	const flushAssistant = (timestamp?: number) => {
		if (!assistantText) {
			assistantText = "";
			assistantTimestamp = undefined;
			return;
		}
		const completedAt = timestamp ?? assistantTimestamp;
		if (completedAt === undefined) {
			missingTimestamps = true;
		}
		turns.push({
			role: "assistant",
			content: assistantText,
			timestamp: completedAt ?? 0,
		});
		assistantText = "";
		assistantTimestamp = undefined;
	};

	let missingTimestamps = false;
	for (const event of events) {
		if (event.type === "user_prompt") {
			flushAssistant();
			if (event.timestamp === undefined) {
				missingTimestamps = true;
			}
			const parsed = parsePromptWithReplyContext(event.text);
			const images = event.images ?? [];
			if (!parsed.prompt && !parsed.replyContext && images.length === 0) {
				continue;
			}
			turns.push({
				role: "user",
				content: parsed.prompt,
				...(parsed.replyContext ? { replyContext: parsed.replyContext } : {}),
				...(images.length > 0 ? { images } : {}),
				timestamp: event.timestamp ?? 0,
			});
		} else if (event.type === "text") {
			assistantText += event.text;
			assistantTimestamp = event.timestamp ?? assistantTimestamp;
		} else if (event.type === "done") {
			flushAssistant(event.timestamp);
		}
	}
	flushAssistant();
	if (missingTimestamps) {
		return null;
	}
	return turns;
}
