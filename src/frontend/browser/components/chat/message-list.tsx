import { useEffect, useRef } from "react";
import type { DisplayMessage } from "../../../../common/protocol.ts";
import { MarkdownContent } from "./markdown-content.tsx";
import { Message } from "./message.tsx";
import { ThinkingBlock } from "./thinking-block.tsx";
import { ThinkingIndicator } from "./thinking-indicator.tsx";

interface MessageListProps {
	messages: DisplayMessage[];
	streamingText: string;
	streamingThinking: string;
	isStreaming: boolean;
	isCompacting: boolean;
	thinkingStartedAt: number | null;
}

export function MessageList({
	messages,
	streamingText,
	streamingThinking,
	isStreaming,
	isCompacting,
	thinkingStartedAt,
}: MessageListProps) {
	const endRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		endRef.current?.scrollIntoView({ block: "end" });
	});

	const hasAssistantOutput = streamingThinking !== "" || streamingText !== "";

	return (
		<div className="scrollbar-none flex-1 overflow-y-auto">
			<div className="mx-auto flex max-w-4xl flex-col gap-4 p-4">
				{messages.map((message) => (
					<Message
						key={
							message.kind === "system"
								? `${message.event}:${message.text}`
								: `${message.role}:${message.content}:${message.replyContext?.text ?? ""}:${message.thinking ?? ""}:${message.images?.map((image) => image.path ?? image.mediaType ?? "image").join("|") ?? ""}`
						}
						message={message}
					/>
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

				<div ref={endRef} />
			</div>
		</div>
	);
}
