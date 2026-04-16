import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

interface DropupMenuProps<T> {
	items: T[];
	selectedIndex: number;
	onSelect: (item: T) => void;
	renderItem: (item: T, active: boolean) => ReactNode;
	itemKey: (item: T) => string;
	emptyMessage?: string;
}

export function DropupMenu<T>({
	items,
	selectedIndex,
	onSelect,
	renderItem,
	itemKey,
	emptyMessage,
}: DropupMenuProps<T>) {
	const listRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const list = listRef.current;
		if (!list) {
			return;
		}

		const selectedItem = list.children[selectedIndex];
		if (!(selectedItem instanceof HTMLElement)) {
			return;
		}

		selectedItem.scrollIntoView({
			block: "nearest",
		});
	}, [selectedIndex]);

	if (items.length === 0) {
		if (!emptyMessage) {
			return null;
		}

		return (
			<div className="absolute bottom-full left-0 right-0 mb-2 rounded-[18px] border border-dark-800 bg-dark-900 px-3 py-3 text-sm text-dark-400 shadow-lg">
				{emptyMessage}
			</div>
		);
	}

	return (
		<div
			ref={listRef}
			className="scrollbar-none absolute bottom-full left-0 right-0 mb-2 max-h-64 overflow-y-auto rounded-[18px] border border-dark-800 bg-dark-900 shadow-lg"
		>
			{items.map((item, index) => {
				const active = index === selectedIndex;
				return (
					<button
						key={itemKey(item)}
						type="button"
						onMouseDown={(event) => {
							event.preventDefault();
							onSelect(item);
						}}
						className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${
							active
								? "bg-dark-800 text-dark-100"
								: "text-dark-300 hover:bg-dark-800/70"
						}`}
					>
						{renderItem(item, active)}
					</button>
				);
			})}
		</div>
	);
}
