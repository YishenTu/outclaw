import { FileViewer } from "../components/file-viewer/file-viewer.tsx";
import { GitDiffViewer } from "../components/git-diff-viewer/git-diff-viewer.tsx";
import { useCodingData } from "./coding-data.ts";
import { CodingSessionView } from "./coding-session-view.tsx";
import {
	codingTabId,
	isCodingDiffTab,
	isCodingFileTab,
} from "./coding-store.ts";
import { CodingTabBar } from "./coding-tab-bar.tsx";

export function CodingCenter() {
	const {
		focusedDiffPath,
		focusedFilePath,
		focusedRepositoryId,
		focusedSession,
		focusedTab,
		handleAddTab,
		handleCloseTab,
		handleSelectTab,
		handleSessionStarted,
		openTabs,
		repository,
		session,
	} = useCodingData();

	const activeTabId = focusedSession ? codingTabId(focusedSession) : undefined;
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
				tabs={openTabs}
				activeTabId={activeTabId}
				onSelect={handleSelectTab}
				onClose={handleCloseTab}
				onAdd={handleAddTab}
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
