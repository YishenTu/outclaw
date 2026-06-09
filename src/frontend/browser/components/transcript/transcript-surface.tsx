import { useEffect, useRef, useState } from "react";
import { TranscriptItemList } from "./transcript-item-list.tsx";
import type {
	ThinkingPresentation,
	TranscriptItem,
} from "./transcript-items.ts";
import {
	createTranscriptAutoScrollState,
	createTranscriptAutoScrollToken,
	resolveTranscriptAutoScrollState,
	shouldShowTranscriptScrollToBottomButton,
	type TranscriptScrollIntent,
} from "./transcript-scroll.ts";

interface TranscriptSurfaceProps {
	emptyMessage?: string;
	items: TranscriptItem[];
	sessionKey?: string | null;
	thinkingPresentation?: ThinkingPresentation;
}

export function TranscriptSurface({
	emptyMessage,
	items,
	sessionKey = null,
	thinkingPresentation = "block",
}: TranscriptSurfaceProps) {
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
			items,
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
	}, [items, sessionKey]);

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
				<div className="mx-auto max-w-4xl p-4">
					<TranscriptItemList
						items={items}
						emptyMessage={emptyMessage}
						thinkingPresentation={thinkingPresentation}
					/>
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
}
