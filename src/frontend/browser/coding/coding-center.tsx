import { lazy, Suspense } from "react";
import { FeatureLoading } from "../components/ui/feature-loading.tsx";
import { useCodingData } from "./coding-data.ts";
import { CodingSessionView } from "./coding-session-view.tsx";
import {
	type CodingTab,
	codingTabId,
	isCodingDiffTab,
	isCodingFileTab,
} from "./coding-store.ts";
import { CodingTabBar } from "./coding-tab-bar.tsx";

const FileViewer = lazy(async () => {
	const module = await import("../components/document-viewers.tsx");
	return { default: module.FileViewer };
});
const GitDiffViewer = lazy(async () => {
	const module = await import("../components/document-viewers.tsx");
	return { default: module.GitDiffViewer };
});

interface CodingCenterProps {
	leftCollapsed?: boolean;
	rightCollapsed?: boolean;
	onExpandLeft?: () => void;
	onExpandRight?: () => void;
}

export function CodingCenter({
	leftCollapsed = false,
	rightCollapsed = false,
	onExpandLeft,
	onExpandRight,
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
				rightCollapsed={rightCollapsed}
				onExpandLeft={onExpandLeft}
				onExpandRight={onExpandRight}
				onSelect={handleSelectTab}
				onClose={handleCloseTab}
				onAdd={handleAddTab}
				onRename={handleRenameTab}
				canAdd={focusedRepositoryId !== undefined}
			/>
			{showFilePreview ? (
				<Suspense fallback={<FeatureLoading label="file viewer" />}>
					<FileViewer
						path={focusedFilePath}
						source={{
							kind: "repository",
							repositoryId: focusedTab.repositoryId,
						}}
					/>
				</Suspense>
			) : showDiffPreview ? (
				<Suspense fallback={<FeatureLoading label="diff" />}>
					<GitDiffViewer
						path={focusedDiffPath}
						repositoryId={focusedTab.repositoryId}
					/>
				</Suspense>
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
