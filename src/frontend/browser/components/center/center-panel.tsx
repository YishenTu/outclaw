import { lazy, Suspense } from "react";
import { LinkedCodingSessionMenuButton } from "../../coding/linked-coding-session-menu-button.tsx";
import { CHAT_TAB } from "../../stores/tab-policy.ts";
import { type Tab, useTabsStore } from "../../stores/tabs.ts";
import { ChatPanel } from "../chat/chat-panel.tsx";
import { FeatureLoading } from "../ui/feature-loading.tsx";
import { TabBarView } from "./tab-bar.tsx";

const FileViewer = lazy(async () => {
	const module = await import("../document-viewers.tsx");
	return { default: module.FileViewer };
});
const GitCommitViewer = lazy(async () => {
	const module = await import("../document-viewers.tsx");
	return { default: module.GitCommitViewer };
});
const GitDiffViewer = lazy(async () => {
	const module = await import("../document-viewers.tsx");
	return { default: module.GitDiffViewer };
});
const LinkedCodingSessionPanel = lazy(async () => {
	const module = await import("../../coding/linked-coding-session-panel.tsx");
	return { default: module.LinkedCodingSessionPanel };
});

interface CenterPanelProps {
	leftCollapsed?: boolean;
	rightCollapsed?: boolean;
	onExpandLeft?: () => void;
	onExpandRight?: () => void;
}

interface CenterPanelViewProps extends CenterPanelProps {
	activeTabId: string;
	closeTab: (tabId: string) => void;
	setActiveTab: (tabId: string) => void;
	tabs: Tab[];
}

export function CenterPanel({
	leftCollapsed = false,
	rightCollapsed = false,
	onExpandLeft,
	onExpandRight,
}: CenterPanelProps) {
	const tabs = useTabsStore((state) => state.tabs);
	const activeTabId = useTabsStore((state) => state.activeTabId);
	const closeTab = useTabsStore((state) => state.closeTab);
	const setActiveTab = useTabsStore((state) => state.setActiveTab);

	return (
		<CenterPanelView
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

export function CenterPanelView({
	activeTabId,
	closeTab,
	leftCollapsed = false,
	rightCollapsed = false,
	onExpandLeft,
	onExpandRight,
	setActiveTab,
	tabs,
}: CenterPanelViewProps) {
	const visibleTabs = tabs.length > 0 ? tabs : [CHAT_TAB];
	const resolvedActiveTabId = visibleTabs.some((tab) => tab.id === activeTabId)
		? activeTabId
		: visibleTabs[0]?.id;

	return (
		<div className="flex h-full flex-col bg-dark-950">
			<TabBarView
				activeTabId={resolvedActiveTabId ?? CHAT_TAB.id}
				actions={<LinkedCodingSessionMenuButton />}
				closeTab={closeTab}
				leftCollapsed={leftCollapsed}
				rightCollapsed={rightCollapsed}
				onExpandLeft={onExpandLeft}
				onExpandRight={onExpandRight}
				setActiveTab={setActiveTab}
				tabs={visibleTabs}
			/>
			<div className="min-h-0 flex-1">
				{visibleTabs.map((tab) => {
					const active = tab.id === resolvedActiveTabId;
					return (
						<div
							key={tab.id}
							data-center-tab-panel={tab.id}
							aria-hidden={!active}
							className={`h-full min-h-0 ${active ? "block" : "hidden"}`}
						>
							<CenterTabPanel tab={tab} active={active} />
						</div>
					);
				})}
			</div>
		</div>
	);
}

function CenterTabPanel({ active, tab }: { active: boolean; tab: Tab }) {
	if (tab.type === "file") {
		return (
			<Suspense fallback={<FeatureLoading label="file viewer" />}>
				<FileViewer
					active={active}
					tabId={tab.id}
					path={tab.path}
					source={{ kind: "agent", agentId: tab.agentId }}
				/>
			</Suspense>
		);
	}

	if (tab.type === "git-commit") {
		return (
			<Suspense fallback={<FeatureLoading label="commit" />}>
				<GitCommitViewer sha={tab.sha} title={tab.title} />
			</Suspense>
		);
	}

	if (tab.type === "git-diff") {
		return (
			<Suspense fallback={<FeatureLoading label="diff" />}>
				<GitDiffViewer path={tab.path} />
			</Suspense>
		);
	}

	if (tab.type === "coding-session") {
		return (
			<Suspense fallback={<FeatureLoading label="coding session" />}>
				<LinkedCodingSessionPanel
					providerId={tab.providerId}
					sdkSessionId={tab.sdkSessionId}
					repositoryId={tab.repositoryId}
					title={tab.title}
				/>
			</Suspense>
		);
	}

	return <ChatPanel active={active} />;
}
