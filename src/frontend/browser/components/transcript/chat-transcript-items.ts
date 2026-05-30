import type {
	AssistantMessageSegment,
	DisplayChatMessage,
	DisplayMessage,
} from "../../../../common/protocol.ts";
import { createLiveAssistantStreamTranscriptItems } from "./live-transcript-stream.ts";
import { shouldShowAssistantUtilityBar } from "./message-render-projection.ts";
import {
	displayMessageKey,
	displayMessageRenderKey,
	type TranscriptItem,
} from "./transcript-items.ts";

interface ChatTranscriptItemsParams {
	isCompacting: boolean;
	isStreaming: boolean;
	messages: DisplayMessage[];
	queuedPrompts?: DisplayChatMessage[];
	sessionKey: string | null;
	streamingText: string;
	streamingThinking: string;
	streamingThinkingBlocks?: string[];
	streamingSegments?: AssistantMessageSegment[];
	thinkingStartedAt: number | null;
}

export function createChatTranscriptItems(
	params: ChatTranscriptItemsParams,
): TranscriptItem[] {
	const items: TranscriptItem[] = [];
	const queuedPrompts = params.queuedPrompts ?? [];

	for (const [index, message] of params.messages.entries()) {
		items.push({
			kind: "message",
			key: displayMessageRenderKey({
				message,
				index,
				sessionKey: params.sessionKey,
			}),
			message,
			scrollKey: displayMessageKey(message),
			showUtilityBar: shouldShowAssistantUtilityBar(message),
		});
	}

	items.push(
		...createLiveAssistantStreamTranscriptItems({
			isCompacting: params.isCompacting,
			isStreaming: params.isStreaming,
			streamingSegments: params.streamingSegments,
			streamingText: params.streamingText,
			streamingThinking: params.streamingThinking,
			streamingThinkingBlocks: params.streamingThinkingBlocks,
			thinkingStartedAt: params.thinkingStartedAt,
		}),
	);

	for (const [index, message] of queuedPrompts.entries()) {
		items.push({
			kind: "message",
			key: `queued-${displayMessageRenderKey({
				message,
				index,
				sessionKey: params.sessionKey,
			})}`,
			message,
			queued: true,
			scrollKey: `queued:${displayMessageKey(message)}`,
		});
	}

	return items;
}
