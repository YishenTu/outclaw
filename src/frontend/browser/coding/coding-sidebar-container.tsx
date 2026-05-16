import { useCodingData } from "./coding-data.ts";
import { CodingSidebar } from "./coding-sidebar.tsx";

interface CodingSidebarContainerProps {
	onCollapse?: () => void;
	onActivateCenterPanel?: () => void;
}

export function CodingSidebarContainer({
	onCollapse,
	onActivateCenterPanel,
}: CodingSidebarContainerProps) {
	const {
		archivedRepositories,
		archivedSessions,
		focusedRepositoryId,
		focusedSession,
		handleArchiveRepository,
		handleArchiveSession,
		handleCreateRepository,
		handleNewSessionForRepository,
		handleRenameSession,
		handleRestoreRepository,
		handleRestoreSession,
		handleSelectRepository,
		handleSelectSession,
		handleTrashRepository,
		handleTrashSession,
		repositories,
		repositoriesLoaded,
		sessionsByRepository,
		trashedRepositories,
		trashedSessions,
	} = useCodingData();

	return (
		<div className="relative flex h-full flex-col">
			<CodingSidebar
				archivedRepositories={archivedRepositories}
				archivedSessions={archivedSessions}
				trashedRepositories={trashedRepositories}
				trashedSessions={trashedSessions}
				repositories={repositories}
				sessionsByRepository={sessionsByRepository}
				focusedRepositoryId={focusedRepositoryId}
				focusedSession={focusedSession}
				onSelectRepository={handleSelectRepository}
				onSelectSession={handleSelectSession}
				onCreateRepository={handleCreateRepository}
				onNewSession={handleNewSessionForRepository}
				onArchiveRepository={handleArchiveRepository}
				onTrashRepository={handleTrashRepository}
				onRestoreRepository={handleRestoreRepository}
				onArchiveSession={handleArchiveSession}
				onTrashSession={handleTrashSession}
				onRestoreSession={handleRestoreSession}
				onRenameSession={handleRenameSession}
				{...(onCollapse ? { onCollapse } : {})}
				{...(onActivateCenterPanel ? { onActivateCenterPanel } : {})}
			/>
			{!repositoriesLoaded && (
				<div className="px-4 py-2 text-[11px] text-dark-500">Loading…</div>
			)}
		</div>
	);
}
