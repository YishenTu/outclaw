import { memo, useMemo } from "react";
import type {
	AssistantMessageSegment,
	DisplayChatMessage,
	DisplayMessage,
} from "../../../../common/protocol.ts";
import { createChatTranscriptItems } from "../transcript/chat-transcript-items.ts";
import { TranscriptSurface } from "../transcript/transcript-surface.tsx";

interface MessageListProps {
	sessionKey?: string | null;
	messages: DisplayMessage[];
	queuedPrompts?: DisplayChatMessage[];
	streamingText: string;
	streamingThinking: string;
	streamingThinkingBlocks?: string[];
	streamingSegments?: AssistantMessageSegment[];
	isStreaming: boolean;
	isCompacting: boolean;
	thinkingStartedAt: number | null;
}

export const MessageList = memo(function MessageList({
	sessionKey = null,
	messages,
	queuedPrompts = [],
	streamingText,
	streamingThinking,
	streamingThinkingBlocks,
	streamingSegments,
	isStreaming,
	isCompacting,
	thinkingStartedAt,
}: MessageListProps) {
	const items = useMemo(
		() =>
			createChatTranscriptItems({
				sessionKey,
				messages,
				queuedPrompts,
				streamingText,
				streamingThinking,
				streamingThinkingBlocks,
				streamingSegments,
				isStreaming,
				isCompacting,
				thinkingStartedAt,
			}),
		[
			sessionKey,
			messages,
			queuedPrompts,
			streamingText,
			streamingThinking,
			streamingThinkingBlocks,
			streamingSegments,
			isStreaming,
			isCompacting,
			thinkingStartedAt,
		],
	);

	return <TranscriptSurface sessionKey={sessionKey} items={items} />;
});
