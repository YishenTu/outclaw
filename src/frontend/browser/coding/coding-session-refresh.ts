import { useEffect } from "react";
import type {
	BrowserCodingSessionDetail,
	BrowserCodingSessionPageResponse,
	BrowserCodingSessionSummary,
} from "../../../common/protocol.ts";
import { fetchCodingSession, fetchCodingSessions } from "../lib/api.ts";
import {
	type CodingState,
	isCodingDiffTab,
	isCodingFileTab,
	isPendingCodingTab,
	useCodingStore,
} from "./coding-store.ts";

export const CODING_SESSION_RECONCILE_INTERVAL_MS = 5_000;

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
	| "removeArchivedSession"
	| "removeSession"
	| "setRepositorySearchResults"
	| "setRepositorySessions"
	| "updateTabTitle"
	| "upsertArchivedSession"
	| "upsertSession"
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
	// Keep this polling browser-local: the backend still reconciles only known
	// sessions, and this hook simply asks for fresh read models on a quiet timer.
	useEffect(() => {
		if (!enabled || typeof window === "undefined") {
			return;
		}

		let cancelled = false;
		let inFlight = false;
		let timer: number | undefined;

		function clearTimer() {
			if (timer === undefined) {
				return;
			}
			window.clearTimeout(timer);
			timer = undefined;
		}

		function scheduleNext() {
			clearTimer();
			timer = window.setTimeout(
				runRefresh,
				CODING_SESSION_RECONCILE_INTERVAL_MS,
			);
		}

		function canRefreshNow() {
			return (
				typeof document === "undefined" ||
				document.visibilityState === "visible"
			);
		}

		function runRefresh() {
			clearTimer();
			if (cancelled) {
				return;
			}
			if (!canRefreshNow()) {
				scheduleNext();
				return;
			}
			if (inFlight) {
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
					if (!cancelled) {
						scheduleNext();
					}
				});
		}

		function handleVisibilityChange() {
			if (canRefreshNow()) {
				runRefresh();
			}
		}

		scheduleNext();
		if (typeof document !== "undefined") {
			document.addEventListener("visibilitychange", handleVisibilityChange);
		}
		return () => {
			cancelled = true;
			clearTimer();
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
		const key = `${tab.providerId}\u0000${tab.sdkSessionId}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		await withRefreshWarning(
			`Failed to refresh coding session ${tab.providerId}/${tab.sdkSessionId}`,
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
		return;
	}

	store.removeArchivedSession(session.providerId, session.sdkSessionId);
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
