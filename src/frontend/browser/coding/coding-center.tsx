import { FileViewer } from "../components/file-viewer/file-viewer.tsx";
import { GitDiffViewer } from "../components/git-diff-viewer/git-diff-viewer.tsx";
import { useCodingData } from "./coding-data.ts";
import { CodingSessionView } from "./coding-session-view.tsx";
import {
	type CodingTab,
	codingTabId,
	isCodingDiffTab,
	isCodingFileTab,
} from "./coding-store.ts";
import { CodingTabBar } from "./coding-tab-bar.tsx";

interface CodingCenterProps {
	leftCollapsed?: boolean;
	onExpandLeft?: () => void;
}

export function CodingCenter({
	leftCollapsed = false,
	onExpandLeft,
}: CodingCenterProps = {}) {
	const {
		focusedDiffPath,
		focusedFilePath,
		focusedRepositoryId,
		focusedTab,
		handleAddTab,
		handleCloseTab,
		handleRenameSession,
		handleSelectTab,
		handleSessionStarted,
		repository,
		session,
		visibleTabs,
	} = useCodingData();

	const handleRenameTab = (tab: CodingTab, title: string) => {
		void handleRenameSession(
			tab.repositoryId,
			{ providerId: tab.providerId, sdkSessionId: tab.sdkSessionId },
			title,
		);
	};

	const activeTabId = focusedTab ? codingTabId(focusedTab) : undefined;
	const showFilePreview =
		focusedTab !== undefined &&
		isCodingFileTab(focusedTab) &&
		focusedFilePath !== undefined &&
		focusedTab.repositoryId !== undefined;
	const showDiffPreview =
		focusedTab !== undefined &&
		isCodingDiffTab(focusedTab) &&
		focusedDiffPath !== undefined &&
		focusedTab.repositoryId !== undefined;

	return (
		<div className="flex h-full min-w-0 flex-1 flex-col bg-dark-950">
			<CodingTabBar
				tabs={visibleTabs}
				activeTabId={activeTabId}
				leftCollapsed={leftCollapsed}
				onExpandLeft={onExpandLeft}
				onSelect={handleSelectTab}
				onClose={handleCloseTab}
				onAdd={handleAddTab}
				onRename={handleRenameTab}
				canAdd={focusedRepositoryId !== undefined}
			/>
			{showFilePreview ? (
				<FileViewer
					path={focusedFilePath}
					source={{
						kind: "repository",
						repositoryId: focusedTab.repositoryId,
					}}
				/>
			) : showDiffPreview ? (
				<GitDiffViewer
					path={focusedDiffPath}
					repositoryId={focusedTab.repositoryId}
				/>
			) : (
				<CodingSessionView
					repository={repository}
					session={session}
					onSessionStarted={handleSessionStarted}
				/>
			)}
		</div>
	);
}
