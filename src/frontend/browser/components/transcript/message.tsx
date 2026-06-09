import { clsx } from "clsx";
import { Heart } from "lucide-react";
import {
	assistantMessageSegmentsFromAggregates,
	hasAssistantMessageSegments,
} from "../../../../common/assistant-message-segments.ts";
import { formatCompactBoundaryIndicator } from "../../../../common/compact-boundary.ts";
import type {
	AssistantMessageSegment,
	DisplayMessage,
} from "../../../../common/protocol.ts";
import { QUEUED_PROMPT_LABEL } from "../../../../common/queued-prompt.ts";
import { AssistantTurnUtilityBar } from "./assistant-turn-utility-bar.tsx";
import { getImageThumbnailClassName } from "./image-thumbnail-styles.ts";
import { MarkdownContent } from "./markdown-content.tsx";
import {
	type ChatImage,
	chatImageKey,
	chatImageLabel,
	inlineChatImageSrc,
} from "./message-render-projection.ts";
import { ThinkingBlock, ThinkingContent } from "./thinking-block.tsx";
import type { ThinkingPresentation } from "./transcript-items.ts";
import { TRANSCRIPT_VERTICAL_GAP_CLASS } from "./transcript-layout.ts";

interface MessageProps {
	message: DisplayMessage;
	queued?: boolean;
	showUtilityBar?: boolean;
	thinkingPresentation?: ThinkingPresentation;
}

function renderImageGallery(images: ChatImage[], role: "user" | "assistant") {
	return (
		<div className="mb-2 flex flex-wrap gap-2">
			{images.map((image, index) => {
				const label = chatImageLabel(index);
				const src = inlineChatImageSrc(image);

				if (src) {
					return (
						<img
							key={chatImageKey(image, index)}
							src={src}
							alt={`${role === "user" ? "User" : "Assistant"} upload ${index + 1}`}
							className={getImageThumbnailClassName("message")}
						/>
					);
				}

				return (
					<div
						key={chatImageKey(image, index)}
						className="font-mono-ui flex h-24 w-24 items-center justify-center rounded-md border border-dark-700 bg-dark-900/80 px-3 text-center text-[11px] uppercase tracking-[0.12em] text-dark-400"
					>
						{label}
					</div>
				);
			})}
		</div>
	);
}

export function Message({
	message,
	queued = false,
	showUtilityBar = false,
	thinkingPresentation = "block",
}: MessageProps) {
	if (message.kind === "system") {
		if (message.event === "compact_boundary") {
			return (
				<div className="font-mono-ui flex justify-center px-3 py-1 text-[12px] text-dark-500">
					<span>{formatCompactBoundaryIndicator(message.text)}</span>
				</div>
			);
		}

		if (message.event === "heartbeat") {
			return (
				<div className="font-mono-ui flex items-center gap-2 px-3 py-1 text-[12px] uppercase tracking-[0.12em] text-dark-500">
					<Heart
						size={12}
						className="text-pink-300"
						strokeWidth={1.8}
						aria-hidden="true"
					/>
					<span>{message.text}</span>
				</div>
			);
		}

		return (
			<div className="font-mono-ui px-3 py-1 text-[12px] uppercase tracking-[0.12em] text-dark-500">
				{message.text}
			</div>
		);
	}

	if (message.role === "user") {
		return (
			<div className="flex flex-col items-end">
				<div className="max-w-[80%] rounded-lg border border-dark-700 bg-dark-800/80 px-4 py-2 text-dark-100">
					{message.replyContext && (
						<div className="mb-2 rounded-md border border-dark-700 bg-dark-900/80 px-3 py-2">
							<div className="font-mono-ui mb-1 text-[10px] uppercase tracking-[0.12em] text-dark-500">
								Replying to
							</div>
							<div className="text-sm leading-snug text-dark-300">
								{message.replyContext.text}
							</div>
						</div>
					)}
					{message.images &&
						message.images.length > 0 &&
						renderImageGallery(message.images, "user")}
					<div className="text-sm whitespace-pre-wrap break-words">
						{message.content}
					</div>
					{queued ? (
						<div className="font-mono-ui mt-2 border-t border-dark-700 pt-2 text-[10px] uppercase tracking-[0.12em] text-dark-400">
							{QUEUED_PROMPT_LABEL}
						</div>
					) : null}
				</div>
			</div>
		);
	}

	const segments = hasAssistantMessageSegments(message.segments)
		? (message.segments ?? [])
		: assistantMessageSegmentsFromAggregates({
				text: message.content,
				thinking: message.thinking ?? "",
				thinkingBlocks: message.thinkingBlocks,
			});

	return (
		<div className="flex flex-col items-start">
			<div className="w-full text-dark-100">
				<div className={clsx("flex flex-col", TRANSCRIPT_VERTICAL_GAP_CLASS)}>
					{withSegmentKeys(segments).map(({ key, segment }) =>
						segment.type === "thinking" ? (
							<ThinkingSegment
								content={segment.text}
								key={key}
								presentation={thinkingPresentation}
							/>
						) : (
							segment.text.trim() !== "" && (
								<div className="px-3" key={key}>
									<MarkdownContent content={segment.text} />
								</div>
							)
						),
					)}
					{message.images && message.images.length > 0 && (
						<div className="px-3">
							<div className={clsx("rounded-md bg-dark-900/40 px-2 py-2")}>
								{renderImageGallery(message.images, "assistant")}
							</div>
						</div>
					)}
				</div>
				{showUtilityBar ? (
					<AssistantTurnUtilityBar
						content={message.content}
						durationMs={message.assistantTurn?.durationMs}
						timestamp={message.timestamp}
					/>
				) : null}
			</div>
		</div>
	);
}

function ThinkingSegment({
	content,
	presentation,
}: {
	content: string;
	presentation: ThinkingPresentation;
}) {
	if (presentation === "inline") {
		return <ThinkingContent content={content} />;
	}

	return <ThinkingBlock content={content} />;
}

function withSegmentKeys(segments: readonly AssistantMessageSegment[]): Array<{
	key: string;
	segment: AssistantMessageSegment;
}> {
	const counts = new Map<string, number>();
	return segments.map((segment) => {
		const head = `${segment.type}:${segment.text.slice(0, 64)}`;
		const seen = counts.get(head) ?? 0;
		counts.set(head, seen + 1);
		return {
			key: seen === 0 ? head : `${head}#${seen}`,
			segment,
		};
	});
}
