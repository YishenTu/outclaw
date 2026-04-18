import {
	FileText,
	GitBranch,
	MessageSquareText,
	PanelLeftClose,
	PanelRightClose,
	X,
} from "lucide-react";
import { useTabsStore } from "../../stores/tabs.ts";

interface TabBarProps {
	leftCollapsed?: boolean;
	rightCollapsed?: boolean;
	onExpandLeft?: () => void;
	onExpandRight?: () => void;
}

export function TabBar({
	leftCollapsed = false,
	rightCollapsed = false,
	onExpandLeft,
	onExpandRight,
}: TabBarProps) {
	const tabs = useTabsStore((state) => state.tabs);
	const activeTabId = useTabsStore((state) => state.activeTabId);
	const closeTab = useTabsStore((state) => state.closeTab);
	const setActiveTab = useTabsStore((state) => state.setActiveTab);

	return (
		<div className="flex h-12 items-stretch border-b border-dark-800 bg-dark-950 px-3">
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
					const active = tab.id === activeTabId;
					return (
						<div
							key={tab.id}
							className={`font-mono-ui group relative flex shrink-0 items-center gap-2 px-2 pt-px text-[12px] uppercase tracking-[0.12em] transition-colors ${
								active ? "text-dark-50" : "text-dark-500 hover:text-dark-200"
							}`}
						>
							{active && (
								<span className="absolute bottom-0 left-0 right-0 -mb-px h-0.5 bg-brand" />
							)}
							<button
								type="button"
								onClick={() => setActiveTab(tab.id)}
								className="flex h-full items-center gap-2"
							>
								{tab.type === "chat" ? (
									<span className="inline-flex items-center gap-2 text-[14px] leading-none">
										<MessageSquareText size={14} />
										Chat
									</span>
								) : tab.type === "git-diff" ? (
									<span className="inline-flex items-center gap-2 leading-none">
										<GitBranch size={14} />
										{tab.path}
									</span>
								) : (
									<span className="inline-flex items-center gap-2 leading-none">
										<FileText size={14} />
										{tab.path}
									</span>
								)}
							</button>
							{tab.type !== "chat" && (
								<button
									type="button"
									onClick={() => closeTab(tab.id)}
									className="rounded p-0.5 text-dark-500 opacity-0 transition-opacity group-hover:opacity-100 hover:text-dark-100"
									aria-label={`Close ${tab.path}`}
								>
									<X size={13} />
								</button>
							)}
						</div>
					);
				})}
			</div>
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
