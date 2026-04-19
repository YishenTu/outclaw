import { useTabsStore } from "../../stores/tabs.ts";
import { ChatPanel } from "../chat/chat-panel.tsx";
import { FileViewer } from "../file-viewer/file-viewer.tsx";
import { GitCommitViewer } from "../git-commit-viewer/git-commit-viewer.tsx";
import { GitDiffViewer } from "../git-diff-viewer/git-diff-viewer.tsx";
import { TabBar } from "./tab-bar.tsx";

interface CenterPanelProps {
	leftCollapsed?: boolean;
	rightCollapsed?: boolean;
	onExpandLeft?: () => void;
	onExpandRight?: () => void;
}

export function CenterPanel({
	leftCollapsed = false,
	rightCollapsed = false,
	onExpandLeft,
	onExpandRight,
}: CenterPanelProps) {
	const tabs = useTabsStore((state) => state.tabs);
	const activeTabId = useTabsStore((state) => state.activeTabId);
	const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

	return (
		<div className="flex h-full flex-col bg-dark-950">
			<TabBar
				leftCollapsed={leftCollapsed}
				rightCollapsed={rightCollapsed}
				onExpandLeft={onExpandLeft}
				onExpandRight={onExpandRight}
			/>
			<div className="min-h-0 flex-1">
				{activeTab?.type === "file" ? (
					<FileViewer
						tabId={activeTab.id}
						path={activeTab.path}
						agentId={activeTab.agentId}
					/>
				) : activeTab?.type === "git-commit" ? (
					<GitCommitViewer sha={activeTab.sha} title={activeTab.title} />
				) : activeTab?.type === "git-diff" ? (
					<GitDiffViewer path={activeTab.path} />
				) : (
					<ChatPanel />
				)}
			</div>
		</div>
	);
}
