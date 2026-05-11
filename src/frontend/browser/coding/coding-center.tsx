import { useCodingData } from "./coding-data.ts";
import { CodingSessionView } from "./coding-session-view.tsx";
import { codingTabId } from "./coding-store.ts";
import { CodingTabBar } from "./coding-tab-bar.tsx";

export function CodingCenter() {
	const {
		focusedRepositoryId,
		focusedSession,
		handleAddTab,
		handleCloseTab,
		handleSelectTab,
		handleSessionStarted,
		openTabs,
		repository,
		session,
	} = useCodingData();

	const activeTabId = focusedSession ? codingTabId(focusedSession) : undefined;

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
			<CodingSessionView
				repository={repository}
				session={session}
				onSessionStarted={handleSessionStarted}
			/>
		</div>
	);
}
