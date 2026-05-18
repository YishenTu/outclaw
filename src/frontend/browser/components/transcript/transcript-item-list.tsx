import { Message } from "./message.tsx";
import { ThinkingBlock } from "./thinking-block.tsx";
import { ThinkingIndicator } from "./thinking-indicator.tsx";
import type { TranscriptItem } from "./transcript-items.ts";

interface TranscriptItemListProps {
	emptyMessage?: string;
	items: TranscriptItem[];
}

export function TranscriptItemList({
	emptyMessage,
	items,
}: TranscriptItemListProps) {
	if (items.length === 0 && emptyMessage) {
		return <div className="text-sm text-dark-400">{emptyMessage}</div>;
	}

	return (
		<>
			{items.map((item) => (
				<TranscriptItemView key={item.key} item={item} />
			))}
		</>
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
