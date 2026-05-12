import {
	FileDiff,
	FileText,
	MessageSquareText,
	PanelLeftClose,
	Plus,
	X,
} from "lucide-react";
import {
	type CodingTab,
	codingTabId,
	isCodingDiffTab,
	isCodingFileTab,
} from "./coding-store.ts";

interface CodingTabBarProps {
	tabs: CodingTab[];
	activeTabId: string | undefined;
	leftCollapsed?: boolean;
	canAdd?: boolean;
	onExpandLeft?: () => void;
	onAdd?: () => void;
	onSelect(tab: CodingTab): void;
	onClose(tab: CodingTab): void;
}

export function CodingTabBar({
	tabs,
	activeTabId,
	leftCollapsed = false,
	canAdd = true,
	onExpandLeft,
	onAdd,
	onSelect,
	onClose,
}: CodingTabBarProps) {
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
				{tabs.map((tab) => {
					const id = codingTabId(tab);
					const active = id === activeTabId;
					const kind: CodingTabKind = isCodingDiffTab(tab)
						? "diff"
						: isCodingFileTab(tab)
							? "file"
							: "session";
					return (
						<div
							key={id}
							className={`font-mono-ui group relative grid shrink-0 items-stretch pt-px text-[14px] uppercase tracking-[0.12em] transition-colors ${
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
								<CodingTabContent title={tab.title} kind={kind} />
							</span>
							<button
								type="button"
								onClick={() => onSelect(tab)}
								className="absolute inset-0 flex h-full min-w-0 items-center overflow-hidden px-2 pr-2 transition-[padding] group-hover:pr-6"
							>
								<CodingTabContent title={tab.title} kind={kind} />
							</button>
							<button
								type="button"
								onClick={() => onClose(tab)}
								className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center justify-center rounded p-0.5 text-dark-500 opacity-0 transition-opacity group-hover:opacity-100 hover:text-dark-100"
								aria-label={`Close ${tab.title}`}
							>
								<X size={13} />
							</button>
						</div>
					);
				})}
				{onAdd && (
					<button
						type="button"
						onClick={onAdd}
						disabled={!canAdd}
						title={
							canAdd
								? "New coding session"
								: "Select a repository to start a new session"
						}
						aria-label="New coding session"
						className="flex shrink-0 items-center justify-center self-center rounded p-1 text-dark-500 transition-colors hover:text-dark-100 disabled:cursor-not-allowed disabled:opacity-40"
					>
						<Plus size={14} />
					</button>
				)}
			</div>
		</div>
	);
}

type CodingTabKind = "session" | "file" | "diff";

function CodingTabContent({
	title,
	kind,
}: {
	title: string;
	kind: CodingTabKind;
}) {
	return (
		<span className="inline-flex min-w-0 items-center gap-2 leading-none">
			{kind === "diff" ? (
				<FileDiff size={14} className="shrink-0" />
			) : kind === "file" ? (
				<FileText size={14} className="shrink-0" />
			) : (
				<MessageSquareText size={14} className="shrink-0" />
			)}
			<span className="min-w-0 truncate">{title}</span>
		</span>
	);
}
