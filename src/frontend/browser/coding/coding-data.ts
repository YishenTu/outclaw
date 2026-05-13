import { useCallback, useEffect } from "react";
import type {
	BrowserCodingRepositorySummary,
	BrowserCodingSessionSummary,
} from "../../../common/protocol.ts";
import {
	archiveCodingRepository,
	archiveCodingSession,
	fetchCodingModels,
	fetchCodingRepositories,
	fetchCodingSession,
	fetchCodingSessions,
	renameCodingSession,
	restoreCodingRepository,
	restoreCodingSession,
} from "../lib/api.ts";
import type { CodingTab } from "./coding-store.ts";
import {
	isCodingDiffTab,
	isCodingFileTab,
	makeCodingFileTab,
	makePendingCodingTab,
	useCodingStore,
	visibleCodingTabs,
} from "./coding-store.ts";

function describeTabTitle(session: {
	title: string;
	sdkSessionId: string;
}): string {
	return session.title?.trim() || session.sdkSessionId;
}

export function resolveFocusedCodingRepository(
	repositories: BrowserCodingRepositorySummary[],
	focusedRepositoryId: string | undefined,
): BrowserCodingRepositorySummary | undefined {
	if (!focusedRepositoryId) {
		return undefined;
	}
	return repositories.find((entry) => entry.id === focusedRepositoryId);
}

export function resolveFocusedCodingSession(params: {
	archivedSessions: BrowserCodingSessionSummary[];
	focusedSession:
		| {
				providerId: string;
				sdkSessionId: string;
		  }
		| undefined;
	sessions: BrowserCodingSessionSummary[];
}): BrowserCodingSessionSummary | undefined {
	if (!params.focusedSession) {
		return undefined;
	}
	return (
		params.sessions.find(
			(entry) =>
				entry.providerId === params.focusedSession?.providerId &&
				entry.sdkSessionId === params.focusedSession?.sdkSessionId,
		) ??
		params.archivedSessions.find(
			(entry) =>
				entry.providerId === params.focusedSession?.providerId &&
				entry.sdkSessionId === params.focusedSession?.sdkSessionId,
		)
	);
}

export function createProvisionalCodingSessionSummary(
	repository: BrowserCodingRepositorySummary,
	summary: { providerId: string; sdkSessionId: string; prompt?: string },
	timestamp = Date.now(),
): BrowserCodingSessionSummary {
	const title = summary.prompt?.trim() || summary.sdkSessionId;
	return {
		providerId: summary.providerId,
		sdkSessionId: summary.sdkSessionId,
		repositoryId: repository.id,
		title,
		model: "",
		lastActive: timestamp,
		cwd: repository.rootCwd,
		lifecycleStatus: "open",
		runStatus: "running",
		createdAt: timestamp,
		source: "code",
		tag: "code",
	};
}

/**
 * Keeps the code-mode data fetch effects mounted once at the layout level so
 * the left and center panes can read the same store state without duplicating
 * repository/session/model requests.
 */
export function useCodingDataLoader(enabled = true) {
	const repositoriesLoaded = useCodingStore(
		(state) => state.repositoriesLoaded,
	);
	const sessionsByRepository = useCodingStore(
		(state) => state.sessionsByRepository,
	);
	const focusedRepositoryId = useCodingStore(
		(state) => state.focusedRepositoryId,
	);
	const setRepositories = useCodingStore((state) => state.setRepositories);
	const setRepositorySessions = useCodingStore(
		(state) => state.setRepositorySessions,
	);
	const codingModelsLoaded = useCodingStore(
		(state) => state.codingModelsLoaded,
	);
	const setCodingModels = useCodingStore((state) => state.setCodingModels);

	useEffect(() => {
		if (!enabled || repositoriesLoaded) {
			return;
		}
		void fetchCodingRepositories({ includeArchived: true })
			.then((result) => {
				setRepositories(result.repositories);
			})
			.catch((error) => {
				console.warn("Failed to load coding repositories", error);
			});
	}, [enabled, repositoriesLoaded, setRepositories]);

	useEffect(() => {
		if (!enabled || codingModelsLoaded) {
			return;
		}
		void fetchCodingModels()
			.then((result) => {
				setCodingModels(result.models);
			})
			.catch((error) => {
				console.warn("Failed to load coding models", error);
			});
	}, [codingModelsLoaded, enabled, setCodingModels]);

	useEffect(() => {
		if (!enabled || !focusedRepositoryId) {
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
	}, [
		enabled,
		focusedRepositoryId,
		sessionsByRepository,
		setRepositorySessions,
	]);
}

/**
 * Exposes the derived data and handlers the sidebar/center components need to
 * manipulate selection and absorb a freshly-started session.
 */
export function useCodingData() {
	const repositories = useCodingStore((state) => state.repositories);
	const repositoriesLoaded = useCodingStore(
		(state) => state.repositoriesLoaded,
	);
	const sessionsByRepository = useCodingStore(
		(state) => state.sessionsByRepository,
	);
	const archivedSessions = useCodingStore((state) => state.archivedSessions);
	const focusedRepositoryId = useCodingStore(
		(state) => state.focusedRepositoryId,
	);
	const focusedSession = useCodingStore((state) => state.focusedSession);
	const setRepositories = useCodingStore((state) => state.setRepositories);
	const setFocusedRepository = useCodingStore(
		(state) => state.setFocusedRepository,
	);
	const setFocusedSession = useCodingStore((state) => state.setFocusedSession);
	const upsertSession = useCodingStore((state) => state.upsertSession);
	const upsertArchivedSession = useCodingStore(
		(state) => state.upsertArchivedSession,
	);
	const removeSession = useCodingStore((state) => state.removeSession);
	const removeArchivedSession = useCodingStore(
		(state) => state.removeArchivedSession,
	);
	const renameSession = useCodingStore((state) => state.renameSession);
	const updateRepository = useCodingStore((state) => state.updateRepository);
	const openTab = useCodingStore((state) => state.openTab);
	const closeTab = useCodingStore((state) => state.closeTab);
	const updateTabTitle = useCodingStore((state) => state.updateTabTitle);
	const openTabs = useCodingStore((state) => state.openTabs);

	const activeRepositories = repositories.filter(
		(entry) => entry.status === "active",
	);
	const archivedRepositories = repositories.filter(
		(entry) => entry.status === "archived",
	);
	const repository = resolveFocusedCodingRepository(
		repositories,
		focusedRepositoryId,
	);
	const sessions = focusedRepositoryId
		? (sessionsByRepository[focusedRepositoryId] ?? [])
		: [];
	const session = resolveFocusedCodingSession({
		archivedSessions,
		focusedSession,
		sessions,
	});

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
		(repositoryId: string, selected: BrowserCodingSessionSummary) => {
			if (selected.lifecycleStatus === "archived") {
				// Archived search results do not live in the repository's open-session
				// slice, so cache the chosen summary before focusing its tab.
				upsertArchivedSession(selected);
			}
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
		[openTab, upsertArchivedSession],
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
			closeTab(tab.providerId, tab.sdkSessionId, tab.repositoryId);
		},
		[closeTab],
	);

	const handleSessionStarted = useCallback(
		async (
			repositoryId: string,
			summary: { providerId: string; sdkSessionId: string; prompt?: string },
		) => {
			const startedRepository = repositories.find(
				(entry) => entry.id === repositoryId,
			);
			const provisional = startedRepository
				? createProvisionalCodingSessionSummary(startedRepository, summary)
				: undefined;
			if (provisional) {
				upsertSession(repositoryId, provisional);
			}
			openTab({
				providerId: summary.providerId,
				sdkSessionId: summary.sdkSessionId,
				repositoryId,
				title: provisional
					? describeTabTitle(provisional)
					: summary.sdkSessionId,
			});
			try {
				const resolved = await fetchCodingSession(
					summary.providerId,
					summary.sdkSessionId,
				);
				upsertSession(resolved.repositoryId ?? repositoryId, resolved);
				updateTabTitle(
					resolved.providerId,
					resolved.sdkSessionId,
					describeTabTitle(resolved),
				);
			} catch (error) {
				console.warn("Failed to fetch newly created coding session", error);
			}
		},
		[openTab, repositories, updateTabTitle, upsertSession],
	);

	const handleAddTab = useCallback(() => {
		if (!focusedRepositoryId) {
			return;
		}
		openTab(makePendingCodingTab(focusedRepositoryId));
	}, [focusedRepositoryId, openTab]);

	const handleNewSessionForRepository = useCallback(
		(repositoryId: string) => {
			openTab(makePendingCodingTab(repositoryId));
		},
		[openTab],
	);

	const handleRenameSession = useCallback(
		async (
			repositoryId: string,
			target: { providerId: string; sdkSessionId: string },
			title: string,
		) => {
			try {
				const renamed = await renameCodingSession(
					target.providerId,
					target.sdkSessionId,
					title,
				);
				renameSession(
					repositoryId,
					target.providerId,
					target.sdkSessionId,
					renamed.title,
				);
			} catch (error) {
				console.warn("Failed to rename coding session", error);
			}
		},
		[renameSession],
	);

	const handleArchiveSession = useCallback(
		async (
			repositoryId: string,
			target: { providerId: string; sdkSessionId: string },
		) => {
			let archived: Awaited<ReturnType<typeof archiveCodingSession>>;
			try {
				archived = await archiveCodingSession(
					target.providerId,
					target.sdkSessionId,
				);
			} catch (error) {
				console.warn("Failed to archive coding session", error);
				return;
			}
			removeSession(repositoryId, target.providerId, target.sdkSessionId);
			upsertArchivedSession(archived.session);
		},
		[removeSession, upsertArchivedSession],
	);

	const handleRestoreSession = useCallback(
		async (
			repositoryId: string,
			target: { providerId: string; sdkSessionId: string },
		) => {
			let restored: Awaited<ReturnType<typeof restoreCodingSession>>;
			try {
				restored = await restoreCodingSession(
					target.providerId,
					target.sdkSessionId,
				);
			} catch (error) {
				console.warn("Failed to restore coding session", error);
				return;
			}
			removeArchivedSession(target.providerId, target.sdkSessionId);
			upsertSession(
				restored.session.repositoryId ?? repositoryId,
				restored.session,
			);
		},
		[removeArchivedSession, upsertSession],
	);

	const handleArchiveRepository = useCallback(
		async (repositoryId: string) => {
			try {
				const result = await archiveCodingRepository(repositoryId);
				updateRepository(result.repository);
			} catch (error) {
				console.warn("Failed to archive coding repository", error);
			}
		},
		[updateRepository],
	);

	const handleRestoreRepository = useCallback(
		async (repositoryId: string) => {
			try {
				const result = await restoreCodingRepository(repositoryId);
				updateRepository(result.repository);
				setFocusedRepository(result.repository.id);
			} catch (error) {
				console.warn("Failed to restore coding repository", error);
			}
		},
		[setFocusedRepository, updateRepository],
	);

	const handleCreateRepository = useCallback(
		(next: BrowserCodingRepositorySummary) => {
			setRepositories(dedupeRepositories([next, ...repositories]));
			setFocusedRepository(next.id);
		},
		[repositories, setRepositories, setFocusedRepository],
	);

	const handleOpenFile = useCallback(
		(params: { repositoryId: string; path: string }) => {
			openTab(makeCodingFileTab(params.repositoryId, params.path));
		},
		[openTab],
	);

	const visibleTabs = visibleCodingTabs(openTabs, focusedRepositoryId);
	const focusedTab = focusedSession
		? openTabs.find(
				(entry) =>
					entry.providerId === focusedSession.providerId &&
					entry.sdkSessionId === focusedSession.sdkSessionId &&
					entry.repositoryId === focusedRepositoryId,
			)
		: undefined;
	const focusedFilePath =
		focusedTab && isCodingFileTab(focusedTab)
			? focusedTab.sdkSessionId
			: undefined;
	const focusedDiffPath =
		focusedTab && isCodingDiffTab(focusedTab)
			? focusedTab.sdkSessionId
			: undefined;

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
		focusedDiffPath,
		focusedFilePath,
		focusedRepositoryId,
		focusedSession,
		focusedTab,
		handleAddTab,
		handleArchiveRepository,
		handleArchiveSession,
		handleCloseTab,
		handleCreateRepository,
		handleNewSessionForRepository,
		handleOpenFile,
		handleRenameSession,
		handleRestoreRepository,
		handleRestoreSession,
		handleSelectRepository,
		handleSelectSession,
		handleSelectTab,
		handleSessionStarted,
		openTabs,
		archivedRepositories,
		archivedSessions,
		repositories: activeRepositories,
		repositoriesLoaded,
		repository,
		session,
		sessionsByRepository,
		visibleTabs,
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
