import {
	FileText,
	GitBranch,
	GitCommitHorizontal,
	MessageSquareText,
	PanelLeftClose,
	PanelRightClose,
	X,
} from "lucide-react";
import { fileNameFromPath } from "../../lib/path-display.ts";
import { type Tab, useTabsStore } from "../../stores/tabs.ts";

interface TabBarProps {
	leftCollapsed?: boolean;
	rightCollapsed?: boolean;
	onExpandLeft?: () => void;
	onExpandRight?: () => void;
}

interface TabBarViewProps extends TabBarProps {
	activeTabId: string;
	closeTab: (tabId: string) => void;
	setActiveTab: (tabId: string) => void;
	tabs: Tab[];
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
		<TabBarView
			activeTabId={activeTabId}
			closeTab={closeTab}
			leftCollapsed={leftCollapsed}
			onExpandLeft={onExpandLeft}
			onExpandRight={onExpandRight}
			rightCollapsed={rightCollapsed}
			setActiveTab={setActiveTab}
			tabs={tabs}
		/>
	);
}

export function TabBarView({
	activeTabId,
	closeTab,
	leftCollapsed = false,
	rightCollapsed = false,
	onExpandLeft,
	onExpandRight,
	setActiveTab,
	tabs,
}: TabBarViewProps) {
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
					if (tab.type === "chat") {
						return (
							<div
								key={tab.id}
								className={`font-mono-ui group relative flex shrink-0 items-center px-2 pt-px text-[12px] uppercase tracking-[0.12em] transition-colors ${
									active ? "text-dark-50" : "text-dark-500 hover:text-dark-200"
								}`}
							>
								{active ? (
									<span className="absolute bottom-0 left-0 right-0 -mb-px h-0.5 bg-brand" />
								) : null}
								<button
									type="button"
									onClick={() => setActiveTab(tab.id)}
									className="flex h-full items-center gap-2"
								>
									<CenterTabContent tab={tab} />
								</button>
							</div>
						);
					}

					return (
						<div
							key={tab.id}
							className={`font-mono-ui group relative grid shrink-0 items-stretch pt-px text-[12px] uppercase tracking-[0.12em] transition-colors ${
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
								<CenterTabContent tab={tab} />
							</span>
							<button
								type="button"
								onClick={() => setActiveTab(tab.id)}
								className="absolute inset-0 flex h-full min-w-0 items-center overflow-hidden px-2 pr-2 transition-[padding] group-hover:pr-6"
							>
								<CenterTabContent tab={tab} />
							</button>
							<button
								type="button"
								onClick={() => closeTab(tab.id)}
								className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center justify-center rounded p-0.5 text-dark-500 opacity-0 transition-opacity group-hover:opacity-100 hover:text-dark-100"
								aria-label={`Close ${tab.type === "git-commit" ? tab.title : tab.path}`}
							>
								<X size={13} />
							</button>
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

function CenterTabContent({ tab }: { tab: Tab }) {
	if (tab.type === "chat") {
		return (
			<span className="inline-flex min-w-0 items-center gap-2 text-[14px] leading-none">
				<MessageSquareText size={14} className="shrink-0" />
				<span className="min-w-0 truncate">Chat</span>
			</span>
		);
	}

	if (tab.type === "git-commit") {
		return (
			<span className="inline-flex min-w-0 items-center gap-2 leading-none">
				<GitCommitHorizontal size={14} className="shrink-0" />
				<span className="min-w-0 truncate">{tab.title}</span>
			</span>
		);
	}

	if (tab.type === "git-diff") {
		return (
			<span className="inline-flex min-w-0 items-center gap-2 leading-none">
				<GitBranch size={14} className="shrink-0" />
				<span className="min-w-0 truncate">{fileNameFromPath(tab.path)}</span>
			</span>
		);
	}

	return (
		<span className="inline-flex min-w-0 items-center gap-2 leading-none">
			<FileText size={14} className="shrink-0" />
			<span className="min-w-0 truncate">{fileNameFromPath(tab.path)}</span>
		</span>
	);
}
