import { clsx } from "clsx";
import { Message } from "./message.tsx";
import { ThinkingBlock } from "./thinking-block.tsx";
import { ThinkingIndicator } from "./thinking-indicator.tsx";
import type { TranscriptItem } from "./transcript-items.ts";
import { TRANSCRIPT_VERTICAL_GAP_CLASS } from "./transcript-layout.ts";

interface TranscriptItemListProps {
	className?: string;
	emptyMessage?: string;
	items: TranscriptItem[];
}

export function TranscriptItemList({
	className,
	emptyMessage,
	items,
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
				items.map((item) => <TranscriptItemView key={item.key} item={item} />)
			)}
		</div>
	);
}

function TranscriptItemView({ item }: { item: TranscriptItem }) {
	switch (item.kind) {
		case "message":
			return (
				<Message
					message={item.message}
					queued={item.queued}
					showUtilityBar={item.showUtilityBar}
				/>
			);
		case "thinking":
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
