import { useEffect, useRef, useState } from "react";
import type { EffortLevel } from "../../../../common/commands.ts";

const EFFORT_LABELS: Record<EffortLevel, string> = {
	low: "Low",
	medium: "Medium",
	high: "High",
	xhigh: "XHigh",
	max: "Max",
};

export function formatEffortLabel(effort: EffortLevel): string {
	return EFFORT_LABELS[effort];
}

export interface SelectorDropdownItem {
	id: string;
	label: string;
	disabled?: boolean;
}

interface SelectorDropdownProps {
	label: string;
	items: SelectorDropdownItem[];
	selectedId: string | undefined;
	disabled?: boolean;
	minWidthClassName: string;
	onSelect: (item: SelectorDropdownItem) => boolean;
}

export function SelectorDropdown({
	label,
	items,
	selectedId,
	disabled = false,
	minWidthClassName,
	onSelect,
}: SelectorDropdownProps) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		function handlePointerDown(event: MouseEvent) {
			if (ref.current && !ref.current.contains(event.target as Node)) {
				setOpen(false);
			}
		}

		document.addEventListener("mousedown", handlePointerDown);
		return () => {
			document.removeEventListener("mousedown", handlePointerDown);
		};
	}, []);

	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				disabled={disabled}
				onClick={() => setOpen((current) => !current)}
				className="flex items-center rounded px-2 py-0.5 text-xs text-dark-400 transition-colors hover:text-dark-200 disabled:cursor-not-allowed disabled:opacity-40"
			>
				<span>{label}</span>
			</button>
			{open && items.length > 0 && (
				<div
					className={`absolute bottom-full left-0 z-50 mb-2 overflow-hidden rounded-[16px] border border-dark-800 bg-dark-900 shadow-lg ${minWidthClassName}`}
				>
					{items.map((item) => (
						<button
							key={item.id}
							type="button"
							disabled={item.disabled}
							onClick={() => {
								if (item.disabled) {
									return;
								}
								if (onSelect(item) !== false) {
									setOpen(false);
								}
							}}
							className={`block w-full px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
								item.id === selectedId
									? "bg-dark-800 text-dark-100"
									: "text-dark-300 hover:bg-dark-800/70"
							}`}
						>
							{item.label}
						</button>
					))}
				</div>
			)}
		</div>
	);
}
