import { useCallback, useEffect } from "react";
import type { BrowserCodingRepositorySummary } from "../../../common/protocol.ts";
import {
	deleteCodingSession,
	fetchCodingModels,
	fetchCodingRepositories,
	fetchCodingSession,
	fetchCodingSessions,
} from "../lib/api.ts";
import type { CodingTab } from "./coding-store.ts";
import {
	isPendingCodingTab,
	makePendingCodingTab,
	useCodingStore,
} from "./coding-store.ts";

function describeTabTitle(session: {
	title: string;
	sdkSessionId: string;
}): string {
	return session.title?.trim() || session.sdkSessionId;
}

/**
 * Loads repositories and the sessions for the focused repository, and exposes
 * the handlers the sidebar/center components need to manipulate selection and
 * absorb a freshly-started session. Returning a stable shape lets the same
 * data flow drive whichever shell the coding tab is mounted inside of.
 */
export function useCodingData() {
	const repositories = useCodingStore((state) => state.repositories);
	const repositoriesLoaded = useCodingStore(
		(state) => state.repositoriesLoaded,
	);
	const sessionsByRepository = useCodingStore(
		(state) => state.sessionsByRepository,
	);
	const focusedRepositoryId = useCodingStore(
		(state) => state.focusedRepositoryId,
	);
	const focusedSession = useCodingStore((state) => state.focusedSession);
	const setRepositories = useCodingStore((state) => state.setRepositories);
	const setRepositorySessions = useCodingStore(
		(state) => state.setRepositorySessions,
	);
	const setFocusedRepository = useCodingStore(
		(state) => state.setFocusedRepository,
	);
	const setFocusedSession = useCodingStore((state) => state.setFocusedSession);
	const upsertSession = useCodingStore((state) => state.upsertSession);
	const removeSession = useCodingStore((state) => state.removeSession);
	const openTab = useCodingStore((state) => state.openTab);
	const closeTab = useCodingStore((state) => state.closeTab);
	const updateTabTitle = useCodingStore((state) => state.updateTabTitle);
	const openTabs = useCodingStore((state) => state.openTabs);
	const codingModelsLoaded = useCodingStore(
		(state) => state.codingModelsLoaded,
	);
	const setCodingModels = useCodingStore((state) => state.setCodingModels);

	useEffect(() => {
		void fetchCodingRepositories()
			.then((result) => {
				setRepositories(result.repositories);
			})
			.catch((error) => {
				console.warn("Failed to load coding repositories", error);
			});
	}, [setRepositories]);

	useEffect(() => {
		if (codingModelsLoaded) {
			return;
		}
		void fetchCodingModels()
			.then((result) => {
				setCodingModels(result.models);
			})
			.catch((error) => {
				console.warn("Failed to load coding models", error);
			});
	}, [codingModelsLoaded, setCodingModels]);

	useEffect(() => {
		if (!focusedRepositoryId) {
			return;
		}
		if (sessionsByRepository[focusedRepositoryId]) {
			return;
		}
		void fetchCodingSessions({
			limit: 20,
			repositoryId: focusedRepositoryId,
		})
			.then((result) => {
				setRepositorySessions(
					focusedRepositoryId,
					result.sessions,
					result.nextCursor,
				);
			})
			.catch((error) => {
				console.warn("Failed to load coding sessions", error);
			});
	}, [focusedRepositoryId, sessionsByRepository, setRepositorySessions]);

	const repository = repositories.find(
		(entry) => entry.id === focusedRepositoryId,
	);
	const sessions = focusedRepositoryId
		? (sessionsByRepository[focusedRepositoryId] ?? [])
		: [];
	const session = focusedSession
		? sessions.find(
				(entry) =>
					entry.providerId === focusedSession.providerId &&
					entry.sdkSessionId === focusedSession.sdkSessionId,
			)
		: undefined;

	const handleSelectRepository = useCallback(
		(repositoryId: string) => {
			if (repositoryId === focusedRepositoryId) {
				return;
			}
			setFocusedRepository(repositoryId);
		},
		[focusedRepositoryId, setFocusedRepository],
	);

	const handleSelectSession = useCallback(
		(
			repositoryId: string,
			selected: {
				providerId: string;
				sdkSessionId: string;
				title?: string;
			},
		) => {
			// Re-anchor the focused repository alongside the focused session so the
			// right panel resolves files/git/terminal cwd for the session's repo,
			// even when the user clicks a session under a different (expanded) repo
			// from the one currently focused.
			setFocusedRepository(repositoryId);
			openTab({
				providerId: selected.providerId,
				sdkSessionId: selected.sdkSessionId,
				repositoryId,
				title: describeTabTitle({
					title: selected.title ?? "",
					sdkSessionId: selected.sdkSessionId,
				}),
			});
		},
		[openTab, setFocusedRepository],
	);

	const handleSelectTab = useCallback(
		(tab: CodingTab) => {
			// Re-anchor the sidebar to the tab's repo so the center pane finds the
			// session in the loaded sessionsByRepository slice.
			setFocusedRepository(tab.repositoryId);
			setFocusedSession({
				providerId: tab.providerId,
				sdkSessionId: tab.sdkSessionId,
			});
		},
		[setFocusedRepository, setFocusedSession],
	);

	const handleCloseTab = useCallback(
		(tab: CodingTab) => {
			closeTab(tab.providerId, tab.sdkSessionId);
		},
		[closeTab],
	);

	const handleSessionStarted = useCallback(
		async (
			repositoryId: string,
			summary: { providerId: string; sdkSessionId: string },
		) => {
			let resolvedTitle = summary.sdkSessionId;
			try {
				const resolved = await fetchCodingSession(
					summary.providerId,
					summary.sdkSessionId,
				);
				upsertSession(repositoryId, resolved);
				resolvedTitle = describeTabTitle(resolved);
			} catch (error) {
				console.warn("Failed to fetch newly created coding session", error);
			}
			// If a pending tab in the same repo was the launcher, replace it so the
			// tab count doesn't grow on every new-session submit.
			const pending = openTabs.find(
				(entry) =>
					isPendingCodingTab(entry) && entry.repositoryId === repositoryId,
			);
			if (pending) {
				closeTab(pending.providerId, pending.sdkSessionId);
			}
			openTab({
				providerId: summary.providerId,
				sdkSessionId: summary.sdkSessionId,
				repositoryId,
				title: resolvedTitle,
			});
		},
		[closeTab, openTab, openTabs, upsertSession],
	);

	const handleAddTab = useCallback(() => {
		if (!focusedRepositoryId) {
			return;
		}
		openTab(makePendingCodingTab(focusedRepositoryId));
	}, [focusedRepositoryId, openTab]);

	const handleNewSessionForRepository = useCallback(
		(repositoryId: string) => {
			setFocusedRepository(repositoryId);
			openTab(makePendingCodingTab(repositoryId));
		},
		[openTab, setFocusedRepository],
	);

	const handleDeleteSession = useCallback(
		async (
			repositoryId: string,
			target: { providerId: string; sdkSessionId: string },
		) => {
			try {
				await deleteCodingSession(target.providerId, target.sdkSessionId);
			} catch (error) {
				console.warn("Failed to delete coding session", error);
				return;
			}
			removeSession(repositoryId, target.providerId, target.sdkSessionId);
		},
		[removeSession],
	);

	const handleCreateRepository = useCallback(
		(next: BrowserCodingRepositorySummary) => {
			setRepositories(dedupeRepositories([next, ...repositories]));
			setFocusedRepository(next.id);
		},
		[repositories, setRepositories, setFocusedRepository],
	);

	// Keep the active tab's stored title in sync with whatever data we have.
	useEffect(() => {
		if (!session) {
			return;
		}
		const stored = openTabs.find(
			(entry) =>
				entry.providerId === session.providerId &&
				entry.sdkSessionId === session.sdkSessionId,
		);
		const next = describeTabTitle(session);
		if (stored && stored.title !== next) {
			updateTabTitle(session.providerId, session.sdkSessionId, next);
		}
	}, [openTabs, session, updateTabTitle]);

	return {
		focusedRepositoryId,
		focusedSession,
		handleAddTab,
		handleCloseTab,
		handleCreateRepository,
		handleDeleteSession,
		handleNewSessionForRepository,
		handleSelectRepository,
		handleSelectSession,
		handleSelectTab,
		handleSessionStarted,
		openTabs,
		repositories,
		repositoriesLoaded,
		repository,
		session,
		sessionsByRepository,
	};
}

function dedupeRepositories(
	repositories: BrowserCodingRepositorySummary[],
): BrowserCodingRepositorySummary[] {
	const seen = new Set<string>();
	const result: BrowserCodingRepositorySummary[] = [];
	for (const repository of repositories) {
		if (seen.has(repository.id)) {
			continue;
		}
		seen.add(repository.id);
		result.push(repository);
	}
	return result;
}
