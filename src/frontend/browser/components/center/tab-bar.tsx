import {
	FileText,
	GitBranch,
	GitCommitHorizontal,
	MessageSquareText,
} from "lucide-react";
import { fileNameFromPath } from "../../lib/path-display.ts";
import { type Tab, useTabsStore } from "../../stores/tabs.ts";
import { BrowserTabStrip } from "../browser-tab-strip.tsx";

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
		<BrowserTabStrip
			items={tabs.map((tab) => ({
				id: tab.id,
				value: tab,
				title: centerTabTitle(tab),
				icon: centerTabIcon(tab),
				closable: tab.type !== "chat",
				...(tab.type === "chat"
					? {}
					: {
							closeLabel: `Close ${
								tab.type === "git-commit" ? tab.title : tab.path
							}`,
						}),
			}))}
			activeId={activeTabId}
			leftCollapsed={leftCollapsed}
			rightCollapsed={rightCollapsed}
			onExpandLeft={onExpandLeft}
			onExpandRight={onExpandRight}
			onSelect={(tab) => setActiveTab(tab.id)}
			onClose={(tab) => closeTab(tab.id)}
		/>
	);
}

function centerTabTitle(tab: Tab): string {
	if (tab.type === "chat") {
		return "Chat";
	}
	if (tab.type === "git-commit") {
		return tab.title;
	}
	return fileNameFromPath(tab.path);
}

function centerTabIcon(tab: Tab) {
	if (tab.type === "chat") {
		return <MessageSquareText size={14} className="shrink-0" />;
	}

	if (tab.type === "git-commit") {
		return <GitCommitHorizontal size={14} className="shrink-0" />;
	}

	if (tab.type === "git-diff") {
		return <GitBranch size={14} className="shrink-0" />;
	}

	return <FileText size={14} className="shrink-0" />;
}
