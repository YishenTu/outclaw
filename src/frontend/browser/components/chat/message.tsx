import { clsx } from "clsx";
import { Heart } from "lucide-react";
import type { DisplayMessage } from "../../../../common/protocol.ts";
import { MarkdownContent } from "./markdown-content.tsx";
import { ThinkingBlock } from "./thinking-block.tsx";

interface MessageProps {
	message: DisplayMessage;
}

export function Message({ message }: MessageProps) {
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
				<div className="max-w-[80%] rounded-lg bg-dark-800 px-4 py-2 text-dark-100">
					{message.replyContext && (
						<div className="font-mono-ui mb-2 rounded bg-dark-900/80 px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-dark-400">
							Replying to: {message.replyContext.text}
						</div>
					)}
					{message.images && message.images.length > 0 && (
						<div className="mb-2 flex flex-wrap gap-2">
							{message.images.map((image) => (
								<div
									key={`${image.path ?? image.mediaType ?? "image"}:user`}
									className="font-mono-ui rounded bg-dark-700 px-2 py-1 text-xs text-dark-300"
								>
									{image.path ?? "[image]"}
								</div>
							))}
						</div>
					)}
					<div className="text-sm whitespace-pre-wrap break-words">
						{message.content}
					</div>
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
							<div className="flex flex-wrap gap-2">
								{message.images.map((image) => (
									<div
										key={`${image.path ?? image.mediaType ?? "image"}:assistant`}
										className={clsx(
											"font-mono-ui rounded px-2 py-1 text-xs text-dark-300",
											"bg-dark-900",
										)}
									>
										{image.path ?? "[image]"}
									</div>
								))}
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
