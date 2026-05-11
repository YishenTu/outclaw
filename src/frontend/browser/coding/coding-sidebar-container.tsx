import { useCodingData } from "./coding-data.ts";
import { CodingSidebar } from "./coding-sidebar.tsx";

interface CodingSidebarContainerProps {
	onCollapse?: () => void;
}

export function CodingSidebarContainer({
	onCollapse,
}: CodingSidebarContainerProps) {
	const {
		focusedRepositoryId,
		focusedSession,
		handleCreateRepository,
		handleDeleteSession,
		handleNewSessionForRepository,
		handleSelectRepository,
		handleSelectSession,
		repositories,
		repositoriesLoaded,
		sessionsByRepository,
	} = useCodingData();

	return (
		<div className="relative flex h-full flex-col">
			<CodingSidebar
				repositories={repositories}
				sessionsByRepository={sessionsByRepository}
				focusedRepositoryId={focusedRepositoryId}
				focusedSession={focusedSession}
				onSelectRepository={handleSelectRepository}
				onSelectSession={handleSelectSession}
				onCreateRepository={handleCreateRepository}
				onNewSession={handleNewSessionForRepository}
				onDeleteSession={handleDeleteSession}
				{...(onCollapse ? { onCollapse } : {})}
			/>
			{!repositoriesLoaded && (
				<div className="px-4 py-2 text-[11px] text-dark-500">Loading…</div>
			)}
		</div>
	);
}
