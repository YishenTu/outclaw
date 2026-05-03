import { clsx } from "clsx";
import { Heart } from "lucide-react";
import type { DisplayMessage } from "../../../../common/protocol.ts";
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
import { ThinkingBlock } from "./thinking-block.tsx";

interface MessageProps {
	message: DisplayMessage;
	queued?: boolean;
	showUtilityBar?: boolean;
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
}: MessageProps) {
	if (message.kind === "system") {
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

	return (
		<div className="flex flex-col items-start">
			<div className="w-full text-dark-100">
				{message.thinking && (
					<div className="mb-2">
						<ThinkingBlock content={message.thinking} />
					</div>
				)}
				<div className="flex flex-col gap-2">
					{message.content.trim() !== "" && (
						<div className="px-3">
							<MarkdownContent content={message.content} />
						</div>
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
