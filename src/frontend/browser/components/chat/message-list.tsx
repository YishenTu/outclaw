import { memo, useEffect, useRef, useState } from "react";
import type {
	DisplayChatMessage,
	DisplayMessage,
} from "../../../../common/protocol.ts";
import { MarkdownContent } from "./markdown-content.tsx";
import { Message } from "./message.tsx";
import {
	createTranscriptAutoScrollState,
	createTranscriptAutoScrollToken,
	displayMessageRenderKey,
	resolveTranscriptAutoScrollState,
	shouldShowTranscriptScrollToBottomButton,
	type TranscriptScrollIntent,
} from "./message-list-scroll.ts";
import { shouldShowAssistantUtilityBar } from "./message-render-projection.ts";
import { ThinkingBlock } from "./thinking-block.tsx";
import { ThinkingIndicator } from "./thinking-indicator.tsx";

interface MessageListProps {
	sessionKey?: string | null;
	messages: DisplayMessage[];
	queuedPrompts?: DisplayChatMessage[];
	streamingText: string;
	streamingThinking: string;
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
	isStreaming,
	isCompacting,
	thinkingStartedAt,
}: MessageListProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const autoScrollStateRef = useRef(createTranscriptAutoScrollState());
	const lastTouchClientYRef = useRef<number | null>(null);
	const lastAutoScrollTokenRef = useRef<string | null>(null);
	const lastSessionKeyRef = useRef<string | null | undefined>(undefined);
	const [showScrollToBottomButton, setShowScrollToBottomButton] =
		useState(false);

	useEffect(() => {
		const autoScrollToken = createTranscriptAutoScrollToken({
			sessionKey,
			messages,
			queuedPrompts,
			streamingText,
			streamingThinking,
			isStreaming,
			isCompacting,
		});

		if (lastSessionKeyRef.current !== sessionKey) {
			const nextState = createTranscriptAutoScrollState();
			autoScrollStateRef.current = nextState;
			setShowScrollToBottomButton(
				shouldShowTranscriptScrollToBottomButton(nextState),
			);
			lastSessionKeyRef.current = sessionKey;
		}

		if (lastAutoScrollTokenRef.current === autoScrollToken) {
			return;
		}
		lastAutoScrollTokenRef.current = autoScrollToken;

		const container = containerRef.current;
		if (!container || !autoScrollStateRef.current.stickToBottom) {
			return;
		}

		container.scrollTop = container.scrollHeight;
	}, [
		isStreaming,
		isCompacting,
		messages,
		queuedPrompts,
		sessionKey,
		streamingText,
		streamingThinking,
	]);

	const hasAssistantOutput = streamingThinking !== "" || streamingText !== "";

	function updateAutoScrollState(
		intent: TranscriptScrollIntent,
		container: HTMLDivElement,
	) {
		const nextState = resolveTranscriptAutoScrollState(
			autoScrollStateRef.current,
			{
				intent,
				metrics: {
					scrollTop: container.scrollTop,
					clientHeight: container.clientHeight,
					scrollHeight: container.scrollHeight,
				},
			},
		);
		autoScrollStateRef.current = nextState;
		setShowScrollToBottomButton(
			shouldShowTranscriptScrollToBottomButton(nextState),
		);
	}

	function resetAutoScrollState() {
		const nextState = createTranscriptAutoScrollState();
		autoScrollStateRef.current = nextState;
		setShowScrollToBottomButton(
			shouldShowTranscriptScrollToBottomButton(nextState),
		);
	}

	function handleScrollToBottom() {
		const container = containerRef.current;
		if (!container) {
			return;
		}

		resetAutoScrollState();
		container.scrollTop = container.scrollHeight;
	}

	return (
		<div className="relative min-h-0 flex-1">
			<div
				ref={containerRef}
				onWheel={(event) => {
					if (event.deltaY < 0) {
						updateAutoScrollState("away-from-bottom", event.currentTarget);
						return;
					}
					if (event.deltaY > 0) {
						updateAutoScrollState("toward-bottom", event.currentTarget);
					}
				}}
				onScroll={(event) => {
					updateAutoScrollState("none", event.currentTarget);
				}}
				onTouchStart={(event) => {
					lastTouchClientYRef.current = event.touches[0]?.clientY ?? null;
				}}
				onTouchMove={(event) => {
					const currentClientY = event.touches[0]?.clientY;
					const lastClientY = lastTouchClientYRef.current;
					if (currentClientY === undefined || lastClientY === null) {
						lastTouchClientYRef.current = currentClientY ?? null;
						return;
					}

					const scrollDeltaY = lastClientY - currentClientY;
					if (scrollDeltaY < 0) {
						updateAutoScrollState("away-from-bottom", event.currentTarget);
					} else if (scrollDeltaY > 0) {
						updateAutoScrollState("toward-bottom", event.currentTarget);
					}
					lastTouchClientYRef.current = currentClientY;
				}}
				onTouchEnd={() => {
					lastTouchClientYRef.current = null;
				}}
				onTouchCancel={() => {
					lastTouchClientYRef.current = null;
				}}
				className="scrollbar-none h-full overflow-y-auto overflow-x-hidden overscroll-contain"
			>
				<div className="mx-auto flex max-w-4xl flex-col gap-4 p-4">
					{messages.map((message, index) => (
						<Message
							key={displayMessageRenderKey({
								message,
								index,
								sessionKey,
							})}
							message={message}
							showUtilityBar={shouldShowAssistantUtilityBar(message)}
						/>
					))}

					{(hasAssistantOutput || isStreaming || isCompacting) && (
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
								{(isStreaming || isCompacting) && (
									<ThinkingIndicator
										startedAt={thinkingStartedAt}
										isCompacting={isCompacting}
										isWorking={hasAssistantOutput}
									/>
								)}
							</div>
						</div>
					)}
					{queuedPrompts.map((message, index) => (
						<Message
							key={`queued-${displayMessageRenderKey({
								message,
								index,
								sessionKey,
							})}`}
							message={message}
							queued
						/>
					))}
				</div>
			</div>
			{showScrollToBottomButton && (
				<button
					type="button"
					aria-label="Scroll to bottom"
					title="Scroll to bottom"
					onClick={handleScrollToBottom}
					className="font-mono-ui absolute bottom-4 left-1/2 z-20 inline-flex h-6 -translate-x-1/2 items-center justify-center whitespace-nowrap rounded border border-dark-800 bg-dark-950 px-2 text-[11px] uppercase tracking-[0.12em] text-dark-300 shadow-lg transition-colors hover:border-dark-600 hover:text-dark-50 focus:outline-none focus:ring-2 focus:ring-dark-600/60"
				>
					Scroll to bottom
				</button>
			)}
		</div>
	);
});
