import { memo, useEffect, useRef } from "react";
import type { DisplayMessage } from "../../../../common/protocol.ts";
import { MarkdownContent } from "./markdown-content.tsx";
import { Message } from "./message.tsx";
import {
	createTranscriptAutoScrollToken,
	displayMessageKey,
	isNearTranscriptBottom,
} from "./message-list-scroll.ts";
import { ThinkingBlock } from "./thinking-block.tsx";
import { ThinkingIndicator } from "./thinking-indicator.tsx";

interface MessageListProps {
	sessionKey?: string | null;
	messages: DisplayMessage[];
	streamingText: string;
	streamingThinking: string;
	isStreaming: boolean;
	isCompacting: boolean;
	thinkingStartedAt: number | null;
}

export const MessageList = memo(function MessageList({
	sessionKey = null,
	messages,
	streamingText,
	streamingThinking,
	isStreaming,
	isCompacting,
	thinkingStartedAt,
}: MessageListProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const shouldStickToBottomRef = useRef(true);
	const lastAutoScrollTokenRef = useRef<string | null>(null);
	const lastSessionKeyRef = useRef<string | null | undefined>(undefined);

	useEffect(() => {
		const autoScrollToken = createTranscriptAutoScrollToken({
			sessionKey,
			messages,
			streamingText,
			streamingThinking,
			isStreaming,
		});

		if (lastSessionKeyRef.current !== sessionKey) {
			shouldStickToBottomRef.current = true;
			lastSessionKeyRef.current = sessionKey;
		}

		if (lastAutoScrollTokenRef.current === autoScrollToken) {
			return;
		}
		lastAutoScrollTokenRef.current = autoScrollToken;

		const container = containerRef.current;
		if (!container || !shouldStickToBottomRef.current) {
			return;
		}

		container.scrollTop = container.scrollHeight;
	}, [isStreaming, messages, sessionKey, streamingText, streamingThinking]);

	const hasAssistantOutput = streamingThinking !== "" || streamingText !== "";

	return (
		<div
			ref={containerRef}
			onScroll={(event) => {
				shouldStickToBottomRef.current = isNearTranscriptBottom({
					scrollTop: event.currentTarget.scrollTop,
					clientHeight: event.currentTarget.clientHeight,
					scrollHeight: event.currentTarget.scrollHeight,
				});
			}}
			className="scrollbar-none flex-1 overflow-y-auto"
		>
			<div className="mx-auto flex max-w-4xl flex-col gap-4 p-4">
				{messages.map((message) => (
					<Message key={displayMessageKey(message)} message={message} />
				))}

				{(hasAssistantOutput || isStreaming) && (
					<div className="w-full text-dark-100">
						{streamingThinking !== "" && (
							<ThinkingBlock content={streamingThinking} />
						)}
						<div className="flex flex-col gap-2">
							{streamingText !== "" && (
								<div className="px-3">
									<MarkdownContent content={streamingText} />
								</div>
							)}
							{isStreaming && (
								<ThinkingIndicator
									startedAt={thinkingStartedAt}
									isCompacting={isCompacting}
									isWorking={hasAssistantOutput}
								/>
							)}
						</div>
					</div>
				)}
			</div>
		</div>
	);
});
