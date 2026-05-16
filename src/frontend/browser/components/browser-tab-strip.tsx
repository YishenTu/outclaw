import { PanelLeftClose, PanelRightClose, Plus, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

export interface BrowserTabStripItem<T> {
	id: string;
	value: T;
	title: string;
	icon: ReactNode;
	closable?: boolean;
	renamable?: boolean;
	closeLabel?: string;
}

export interface BrowserTabStripAddButton {
	ariaLabel: string;
	title: string;
	disabled?: boolean;
	onClick: () => void;
}

interface BrowserTabStripProps<T> {
	items: BrowserTabStripItem<T>[];
	activeId: string | undefined;
	leftCollapsed?: boolean;
	rightCollapsed?: boolean;
	onExpandLeft?: () => void;
	onExpandRight?: () => void;
	onSelect: (item: T) => void;
	onClose?: (item: T) => void;
	onRename?: (item: T, title: string) => void;
	addButton?: BrowserTabStripAddButton;
	actions?: ReactNode;
	textSizeClassName?: string;
}

export function BrowserTabStrip<T>({
	items,
	activeId,
	leftCollapsed = false,
	rightCollapsed = false,
	onExpandLeft,
	onExpandRight,
	onSelect,
	onClose,
	onRename,
	addButton,
	actions,
	textSizeClassName = "text-[12px]",
}: BrowserTabStripProps<T>) {
	const [editingItemId, setEditingItemId] = useState<string | null>(null);
	const [draftTitle, setDraftTitle] = useState("");
	const inputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		if (!editingItemId) {
			return;
		}
		if (!items.some((item) => item.id === editingItemId)) {
			setEditingItemId(null);
			setDraftTitle("");
		}
	}, [editingItemId, items]);

	useEffect(() => {
		if (!editingItemId) {
			return;
		}
		const frame = window.requestAnimationFrame(() => {
			inputRef.current?.focus();
			inputRef.current?.select();
		});
		return () => window.cancelAnimationFrame(frame);
	}, [editingItemId]);

	function startEditing(item: BrowserTabStripItem<T>) {
		if (!item.renamable || !onRename) {
			return;
		}
		setEditingItemId(item.id);
		setDraftTitle(item.title);
	}

	function commitRename(item: BrowserTabStripItem<T>) {
		const next = draftTitle.trim();
		if (next !== "" && next !== item.title) {
			onRename?.(item.value, next);
		}
		setEditingItemId(null);
		setDraftTitle("");
	}

	function cancelRename() {
		setEditingItemId(null);
		setDraftTitle("");
	}

	return (
		<div className="flex h-12 shrink-0 items-stretch border-b border-dark-800 bg-dark-950 px-3">
			{leftCollapsed && onExpandLeft && (
				<button
					type="button"
					onClick={onExpandLeft}
					className="mr-2 flex items-center justify-center text-dark-500 transition-colors hover:text-dark-100"
					aria-label="Expand left sidebar"
				>
					<PanelLeftClose size={15} />
				</button>
			)}
			<div className="flex min-w-0 flex-1 items-stretch gap-2 overflow-x-auto overflow-y-hidden [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
				{items.map((item) => {
					const active = item.id === activeId;
					const editing = item.id === editingItemId;
					const closable = item.closable === true && onClose !== undefined;
					return (
						<div
							key={item.id}
							className={`font-mono-ui group relative grid shrink-0 items-stretch pt-px ${textSizeClassName} uppercase tracking-[0.12em] transition-colors ${
								active ? "text-dark-50" : "text-dark-500 hover:text-dark-200"
							}`}
						>
							{active ? (
								<span className="absolute bottom-0 left-0 right-0 -mb-px h-0.5 bg-brand" />
							) : null}
							<span
								aria-hidden="true"
								className="invisible col-start-1 row-start-1 flex h-full max-w-52 items-center gap-2 overflow-hidden px-2 leading-none"
							>
								<TabStripContent
									icon={item.icon}
									title={editing ? draftTitle || item.title : item.title}
								/>
							</span>
							{editing ? (
								<div className="col-start-1 row-start-1 flex h-full min-w-0 items-center gap-2 overflow-hidden px-2">
									{item.icon}
									<input
										ref={inputRef}
										value={draftTitle}
										onChange={(event) => setDraftTitle(event.target.value)}
										onBlur={() => commitRename(item)}
										onKeyDown={(event) => {
											if (event.key === "Enter") {
												event.preventDefault();
												commitRename(item);
												return;
											}
											if (event.key === "Escape") {
												event.preventDefault();
												cancelRename();
											}
										}}
										className={`min-w-0 flex-1 bg-transparent font-mono-ui ${textSizeClassName} uppercase tracking-[0.12em] text-dark-50 outline-none`}
										aria-label={`Rename ${item.title}`}
									/>
								</div>
							) : (
								<button
									type="button"
									onClick={() => onSelect(item.value)}
									onDoubleClick={
										item.renamable && onRename
											? (event) => {
													event.preventDefault();
													startEditing(item);
												}
											: undefined
									}
									className={`absolute inset-0 flex h-full min-w-0 items-center overflow-hidden px-2 pr-2 transition-[padding] ${
										closable ? "group-hover:pr-6" : ""
									}`}
								>
									<TabStripContent icon={item.icon} title={item.title} />
								</button>
							)}
							{closable && !editing ? (
								<button
									type="button"
									onClick={() => onClose(item.value)}
									className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center justify-center rounded p-0.5 text-dark-500 opacity-0 transition-opacity group-hover:opacity-100 hover:text-dark-100"
									aria-label={item.closeLabel ?? `Close ${item.title}`}
								>
									<X size={13} />
								</button>
							) : null}
						</div>
					);
				})}
				{addButton && (
					<button
						type="button"
						onClick={addButton.onClick}
						disabled={addButton.disabled}
						title={addButton.title}
						aria-label={addButton.ariaLabel}
						className="flex shrink-0 items-center justify-center self-center rounded p-1 text-dark-500 transition-colors hover:text-dark-100 disabled:cursor-not-allowed disabled:opacity-40"
					>
						<Plus size={14} />
					</button>
				)}
			</div>
			{actions ? (
				<div className="ml-2 flex shrink-0 items-center">{actions}</div>
			) : null}
			{rightCollapsed && onExpandRight && (
				<button
					type="button"
					onClick={onExpandRight}
					className="ml-2 flex items-center justify-center text-dark-500 transition-colors hover:text-dark-100"
					aria-label="Expand right sidebar"
				>
					<PanelRightClose size={15} />
				</button>
			)}
		</div>
	);
}

function TabStripContent({ icon, title }: { icon: ReactNode; title: string }) {
	return (
		<span className="inline-flex min-w-0 items-center gap-2 leading-none">
			{icon}
			<span className="min-w-0 truncate">{title}</span>
		</span>
	);
}
