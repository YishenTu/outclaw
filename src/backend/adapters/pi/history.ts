import {
	aggregateAssistantMessageSegments,
	assistantMessageSegmentsFromAggregates,
	assistantMessageSegmentsNeedOrderedDisplay,
	cloneAssistantMessageSegments,
} from "../../../common/assistant-message-segments.ts";
import { createDisplayCompactBoundaryMessage } from "../../../common/compact-boundary.ts";
import type {
	DisplayChatMessage,
	DisplayCompactBoundaryMessage,
	DisplayMessage,
	TranscriptTurn,
} from "../../../common/protocol.ts";
import { parsePromptWithReplyContext } from "../../../common/reply-context.ts";
import type {
	PiDriverMessage,
	PiDriverSession,
	PiDriverSessionEntry,
} from "./types.ts";

export function projectPiDisplayMessages(
	session: PiDriverSession,
): DisplayMessage[] {
	const messages: DisplayMessage[] = [];
	for (const entry of sessionEntries(session)) {
		if (entry.type === "compaction") {
			messages.push(projectPiCompactionBoundary(entry));
			continue;
		}
		if (isDisplayablePiMessage(entry.message)) {
			messages.push(projectPiDisplayMessage(entry.message));
		}
	}
	return messages;
}

export function projectPiTranscriptTurns(
	session: PiDriverSession,
): TranscriptTurn[] {
	return sessionEntries(session)
		.filter(
			(entry): entry is Extract<PiDriverSessionEntry, { type: "message" }> =>
				entry.type === "message" && isDisplayablePiMessage(entry.message),
		)
		.map(({ message }) => {
			const timestamp = requireDurableTimestamp(session.id, message.timestamp);
			if (message.role === "user") {
				const parsed = parsePromptWithReplyContext(message.content);
				return {
					role: "user",
					content: parsed.prompt,
					timestamp,
					...(message.images !== undefined ? { images: message.images } : {}),
					...(parsed.replyContext !== undefined
						? { replyContext: parsed.replyContext }
						: {}),
				};
			}
			return {
				role: "assistant",
				content: aggregateAssistant(message).content,
				timestamp,
			};
		});
}

function sessionEntries(session: PiDriverSession): PiDriverSessionEntry[] {
	return (
		session.entries ??
		session.messages.map((message) => ({ type: "message", message }))
	);
}

function projectPiCompactionBoundary(
	entry: Extract<PiDriverSessionEntry, { type: "compaction" }>,
): DisplayCompactBoundaryMessage {
	const boundary = createDisplayCompactBoundaryMessage();
	return entry.tokensBefore !== undefined
		? { ...boundary, preTokens: entry.tokensBefore }
		: boundary;
}

function requireDurableTimestamp(
	sessionId: string,
	timestamp: number | undefined,
): number {
	if (timestamp === undefined || !Number.isFinite(timestamp)) {
		throw new Error(
			`Pi transcript export requires durable per-message timestamps; session ${sessionId} has a message without one`,
		);
	}
	return timestamp;
}

function displayTimestamp(timestamp: number | undefined): number | undefined {
	return timestamp !== undefined && Number.isFinite(timestamp)
		? timestamp
		: undefined;
}

function isDisplayablePiMessage(message: PiDriverMessage): boolean {
	if (message.role === "user") {
		return true;
	}
	const assistant = aggregateAssistant(message);
	return (
		assistant.content !== "" ||
		assistant.thinking !== "" ||
		assistant.thinkingBlocks.length > 0
	);
}

function projectPiDisplayMessage(message: PiDriverMessage): DisplayChatMessage {
	const timestamp = displayTimestamp(message.timestamp);
	if (message.role === "user") {
		const parsed = parsePromptWithReplyContext(message.content);
		return {
			kind: "chat",
			role: "user",
			content: parsed.prompt,
			...(message.images !== undefined ? { images: message.images } : {}),
			...(parsed.replyContext !== undefined
				? { replyContext: parsed.replyContext }
				: {}),
			...(timestamp !== undefined ? { timestamp } : {}),
		};
	}

	const assistant = aggregateAssistant(message);
	return {
		kind: "chat",
		role: "assistant",
		content: assistant.content,
		...(assistant.thinking !== "" ? { thinking: assistant.thinking } : {}),
		...(assistant.thinkingBlocks.length > 0
			? { thinkingBlocks: assistant.thinkingBlocks }
			: {}),
		...(assistant.segments !== undefined
			? { segments: assistant.segments }
			: {}),
		...(timestamp !== undefined ? { timestamp } : {}),
	};
}

function aggregateAssistant(
	message: Extract<PiDriverMessage, { role: "assistant" }>,
) {
	const segments =
		message.segments ??
		assistantMessageSegmentsFromAggregates({
			text: message.content ?? "",
			thinking: message.thinking ?? "",
			thinkingBlocks: message.thinkingBlocks,
		});
	const aggregate = aggregateAssistantMessageSegments(segments);
	return {
		content: aggregate.text,
		thinking: aggregate.thinking,
		thinkingBlocks: aggregate.thinkingBlocks,
		segments: assistantMessageSegmentsNeedOrderedDisplay(segments)
			? cloneAssistantMessageSegments(segments)
			: undefined,
	};
}
