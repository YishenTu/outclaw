import type {
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
	for (const [index, block] of thinkingBlocks.entries()) {
		items.push({
			kind: "thinking",
			key: `streaming-thinking-${index}`,
			content: block,
			scrollKey: `thinking:${block}`,
		});
	}

	if (params.streamingText !== "") {
		items.push({
			kind: "message",
			key: "streaming-text",
			message: assistantTranscriptMessage(params.streamingText),
			scrollKey: `streaming-text:${params.streamingText}`,
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
