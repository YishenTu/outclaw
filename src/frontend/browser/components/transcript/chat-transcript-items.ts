import {
	assistantMessageSegmentsFromAggregates,
	hasAssistantMessageSegments,
} from "../../../../common/assistant-message-segments.ts";
import type {
	AssistantMessageSegment,
	DisplayChatMessage,
	DisplayMessage,
} from "../../../../common/protocol.ts";
import { effectiveThinkingBlocks } from "../../../../common/thinking-blocks.ts";
import { shouldShowAssistantUtilityBar } from "./message-render-projection.ts";
import {
	assistantTranscriptMessage,
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

	const thinkingBlocks = effectiveThinkingBlocks({
		text: params.streamingThinking,
		blocks: params.streamingThinkingBlocks,
	});
	const segments = hasAssistantMessageSegments(params.streamingSegments)
		? (params.streamingSegments ?? [])
		: assistantMessageSegmentsFromAggregates({
				text: params.streamingText,
				thinking: params.streamingThinking,
				thinkingBlocks: params.streamingThinkingBlocks,
			});
	for (const [index, segment] of segments.entries()) {
		if (segment.type === "thinking") {
			items.push({
				kind: "thinking",
				key: `streaming-thinking-${index}`,
				content: segment.text,
				scrollKey: `thinking:${segment.text}`,
			});
			continue;
		}
		items.push({
			kind: "message",
			key: `streaming-text-${index}`,
			message: assistantTranscriptMessage(segment.text),
			scrollKey: `streaming-text:${segment.text}`,
		});
	}

	if (params.isStreaming || params.isCompacting) {
		const hasAssistantOutput =
			thinkingBlocks.length > 0 || params.streamingText !== "";
		items.push({
			kind: "activity",
			key: "streaming-activity",
			startedAt: params.thinkingStartedAt,
			isCompacting: params.isCompacting,
			isWorking: hasAssistantOutput,
			scrollKey: [
				"activity",
				params.isStreaming ? "streaming" : "idle",
				params.isCompacting ? "compacting" : "not-compacting",
				hasAssistantOutput ? "working" : "thinking",
			].join(":"),
		});
	}

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
