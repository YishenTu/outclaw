import { clsx } from "clsx";
import { Message } from "./message.tsx";
import { ThinkingBlock, ThinkingContent } from "./thinking-block.tsx";
import { ThinkingIndicator } from "./thinking-indicator.tsx";
import type {
	ThinkingPresentation,
	TranscriptItem,
} from "./transcript-items.ts";
import { TRANSCRIPT_VERTICAL_GAP_CLASS } from "./transcript-layout.ts";

interface TranscriptItemListProps {
	className?: string;
	emptyMessage?: string;
	items: TranscriptItem[];
	thinkingPresentation?: ThinkingPresentation;
}

export function TranscriptItemList({
	className,
	emptyMessage,
	items,
	thinkingPresentation = "block",
}: TranscriptItemListProps) {
	if (items.length === 0 && !emptyMessage) {
		return null;
	}

	return (
		<div
			className={clsx(
				"flex w-full flex-col",
				TRANSCRIPT_VERTICAL_GAP_CLASS,
				className,
			)}
		>
			{items.length === 0 ? (
				<div className="text-sm text-dark-400">{emptyMessage}</div>
			) : (
				items.map((item) => (
					<TranscriptItemView
						item={item}
						key={item.key}
						thinkingPresentation={thinkingPresentation}
					/>
				))
			)}
		</div>
	);
}

function TranscriptItemView({
	item,
	thinkingPresentation,
}: {
	item: TranscriptItem;
	thinkingPresentation: ThinkingPresentation;
}) {
	switch (item.kind) {
		case "message":
			return (
				<Message
					message={item.message}
					queued={item.queued}
					showUtilityBar={item.showUtilityBar}
					thinkingPresentation={thinkingPresentation}
				/>
			);
		case "thinking":
			if (thinkingPresentation === "inline") {
				return <ThinkingContent content={item.content} />;
			}
			return <ThinkingBlock content={item.content} />;
		case "activity":
			return (
				<ThinkingIndicator
					startedAt={item.startedAt}
					isCompacting={item.isCompacting}
					isWorking={item.isWorking}
				/>
			);
		case "tool":
			return <>{item.node}</>;
		case "error":
			return <div className="text-xs text-danger">{item.message}</div>;
	}
}
