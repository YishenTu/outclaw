import { useEffect } from "react";
import type {
	BrowserCodingSessionDetail,
	BrowserCodingSessionPageResponse,
	BrowserCodingSessionSummary,
} from "../../../common/protocol.ts";
import {
	formatProviderSessionRef,
	providerSessionRefKey,
} from "../../../common/provider-session-ref.ts";
import { fetchCodingSession, fetchCodingSessions } from "../lib/api.ts";
import {
	type CodingState,
	isCodingDiffTab,
	isCodingFileTab,
	isPendingCodingTab,
	useCodingStore,
} from "./coding-store.ts";

const DEFAULT_REPOSITORY_SESSION_LIMIT = 20;
const DEFAULT_SEARCH_SESSION_LIMIT = 10;

type FetchCodingSessionPage = (params: {
	limit: number;
	lifecycleStatus?: "open" | "archived";
	providerId?: string;
	query?: string;
	repositoryId?: string;
}) => Promise<BrowserCodingSessionPageResponse>;

type FetchCodingSessionDetail = (
	providerId: string,
	sdkSessionId: string,
) => Promise<BrowserCodingSessionDetail>;

type CodingSessionRefreshStore = Pick<
	CodingState,
	| "openTabs"
	| "searchByRepository"
	| "sessionsByRepository"
	| "moveSessionToArchive"
	| "moveSessionToTrash"
	| "removeArchivedSession"
	| "removeSession"
	| "removeTrashedSession"
	| "setRepositorySearchResults"
	| "setRepositorySessions"
	| "updateTabTitle"
	| "upsertArchivedSession"
	| "upsertSession"
	| "upsertTrashedSession"
>;

interface RefreshLoadedCodingSessionStateOptions {
	store: CodingSessionRefreshStore;
	fetchSessionDetail?: FetchCodingSessionDetail;
	fetchSessionPage?: FetchCodingSessionPage;
	warn?: (message: string, error: unknown) => void;
}

export async function refreshLoadedCodingSessionState({
	store,
	fetchSessionDetail = fetchCodingSession,
	fetchSessionPage = fetchCodingSessions,
	warn = console.warn,
}: RefreshLoadedCodingSessionStateOptions): Promise<void> {
	await refreshLoadedSessionPages(store, fetchSessionPage, warn);
	await refreshOpenTabDetails(store, fetchSessionDetail, warn);
}

export function useCodingSessionReconciliationPolling(enabled: boolean) {
	// Inbound sync is attention-driven: we refresh once on mount and again
	// whenever the tab regains focus. No background timer — anything that
	// happened in Codex while the user was away gets reconciled as soon as
	// they're looking. A manual Refresh button in the Archive Center handles
	// the rest.
	useEffect(() => {
		if (!enabled || typeof window === "undefined") {
			return;
		}

		let cancelled = false;
		let inFlight = false;

		function canRefreshNow() {
			return (
				typeof document === "undefined" ||
				document.visibilityState === "visible"
			);
		}

		function runRefresh() {
			if (cancelled || inFlight || !canRefreshNow()) {
				return;
			}
			inFlight = true;
			void refreshLoadedCodingSessionState({
				store: useCodingStore.getState(),
			})
				.catch((error) => {
					console.warn("Failed to refresh coding sessions", error);
				})
				.finally(() => {
					inFlight = false;
				});
		}

		function handleVisibilityChange() {
			runRefresh();
		}

		runRefresh();
		if (typeof document !== "undefined") {
			document.addEventListener("visibilitychange", handleVisibilityChange);
		}
		return () => {
			cancelled = true;
			if (typeof document !== "undefined") {
				document.removeEventListener(
					"visibilitychange",
					handleVisibilityChange,
				);
			}
		};
	}, [enabled]);
}

async function refreshLoadedSessionPages(
	store: CodingSessionRefreshStore,
	fetchSessionPage: FetchCodingSessionPage,
	warn: (message: string, error: unknown) => void,
) {
	const repositoryIds = Object.keys(store.sessionsByRepository);
	for (const repositoryId of repositoryIds) {
		const loadedSessions = store.sessionsByRepository[repositoryId] ?? [];
		await withRefreshWarning(
			`Failed to refresh coding sessions for repository ${repositoryId}`,
			warn,
			async () => {
				const page = await fetchSessionPage({
					limit: Math.max(
						DEFAULT_REPOSITORY_SESSION_LIMIT,
						loadedSessions.length,
					),
					repositoryId,
				});
				store.setRepositorySessions(
					repositoryId,
					page.sessions,
					page.nextCursor,
				);
				updateTabTitles(store, page.sessions);
			},
		);
	}

	for (const [repositoryId, search] of Object.entries(
		store.searchByRepository,
	)) {
		await withRefreshWarning(
			`Failed to refresh coding session search for repository ${repositoryId}`,
			warn,
			async () => {
				const page = await fetchSessionPage({
					limit: Math.max(DEFAULT_SEARCH_SESSION_LIMIT, search.sessions.length),
					query: search.query,
					repositoryId,
				});
				store.setRepositorySearchResults(
					repositoryId,
					page.query ?? search.query,
					page.sessions,
					page.nextCursor,
				);
				updateTabTitles(store, page.sessions);
			},
		);
	}
}

async function refreshOpenTabDetails(
	store: CodingSessionRefreshStore,
	fetchSessionDetail: FetchCodingSessionDetail,
	warn: (message: string, error: unknown) => void,
) {
	const seen = new Set<string>();
	for (const tab of store.openTabs) {
		if (
			isPendingCodingTab(tab) ||
			isCodingFileTab(tab) ||
			isCodingDiffTab(tab)
		) {
			continue;
		}
		const key = providerSessionRefKey(tab);
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		await withRefreshWarning(
			`Failed to refresh coding session ${formatProviderSessionRef(tab)}`,
			warn,
			async () => {
				const session = await fetchSessionDetail(
					tab.providerId,
					tab.sdkSessionId,
				);
				syncSessionDetail(store, session, tab.repositoryId);
			},
		);
	}
}

function syncSessionDetail(
	store: CodingSessionRefreshStore,
	session: BrowserCodingSessionSummary,
	fallbackRepositoryId: string,
) {
	const repositoryId = session.repositoryId ?? fallbackRepositoryId;
	if (session.lifecycleStatus === "archived") {
		store.moveSessionToArchive(repositoryId, session);
		store.removeTrashedSession(session.providerId, session.sdkSessionId);
		return;
	}
	if (session.lifecycleStatus === "trashed") {
		store.moveSessionToTrash(repositoryId, session);
		return;
	}

	store.removeArchivedSession(session.providerId, session.sdkSessionId);
	store.removeTrashedSession(session.providerId, session.sdkSessionId);
	store.upsertSession(repositoryId, session);
	updateTabTitles(store, [session]);
}

function updateTabTitles(
	store: Pick<CodingSessionRefreshStore, "updateTabTitle">,
	sessions: BrowserCodingSessionSummary[],
) {
	for (const session of sessions) {
		const title = session.title.trim() || session.sdkSessionId;
		store.updateTabTitle(session.providerId, session.sdkSessionId, title);
	}
}

async function withRefreshWarning(
	message: string,
	warn: (message: string, error: unknown) => void,
	callback: () => Promise<void>,
) {
	try {
		await callback();
	} catch (error) {
		warn(message, error);
	}
}
