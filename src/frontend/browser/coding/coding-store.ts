import { create } from "zustand";
import {
	createJSONStorage,
	persist,
	type StateStorage,
} from "zustand/middleware";
import type { EffortLevel } from "../../../common/commands.ts";
import type {
	BrowserCodingModel,
	BrowserCodingRepositorySummary,
	BrowserCodingSessionRunStatus,
	BrowserCodingSessionSummary,
	SessionCursor,
} from "../../../common/protocol.ts";
import {
	mergeCodingSessions,
	removeCodingSession,
	renameCodingSession as renameCodingSessionInList,
	upsertCodingSession,
} from "./coding-session-collections.ts";

export type BrowserAppMode = "chat" | "code";

export const CODING_STORAGE_KEY = "outclaw.browser.coding";

interface FocusedSessionRef {
	providerId: string;
	sdkSessionId: string;
}

export interface CodingTab {
	providerId: string;
	sdkSessionId: string;
	repositoryId: string;
	title: string;
}

export function codingTabId(tab: {
	providerId: string;
	repositoryId?: string;
	sdkSessionId: string;
}): string {
	return `${tab.repositoryId ?? ""}/${tab.providerId}/${tab.sdkSessionId}`;
}

export function visibleCodingTabs(
	tabs: CodingTab[],
	focusedRepositoryId: string | undefined,
): CodingTab[] {
	if (focusedRepositoryId === undefined) {
		return [];
	}
	return tabs.filter((tab) => tab.repositoryId === focusedRepositoryId);
}

/**
 * Pending tabs are placeholders for a session that hasn't been created yet.
 * They're rendered with the new-session composer in the middle pane; once the
 * user submits a prompt they're replaced with a real tab keyed by the server's
 * `providerId/sdkSessionId`.
 */
export const PENDING_CODING_PROVIDER = "__pending__";

/**
 * File tabs preview a file inside the focused repository. They reuse the
 * provider/session-id pair as a generic tab key: providerId is the sentinel
 * below and sdkSessionId carries the relative path so existing tab plumbing
 * (open/close/focus) works without a separate identity scheme.
 */
export const FILE_CODING_PROVIDER = "__file__";

/**
 * Diff tabs preview the working-tree git diff of a file inside the focused
 * repository, using the same provider-sentinel trick as file tabs so the tab
 * stays uniquely keyed even when a file and its diff are open side by side.
 */
export const DIFF_CODING_PROVIDER = "__diff__";

export function isPendingCodingTab(tab: { providerId: string }): boolean {
	return tab.providerId === PENDING_CODING_PROVIDER;
}

export function isCodingFileTab(tab: { providerId: string }): boolean {
	return tab.providerId === FILE_CODING_PROVIDER;
}

export function isCodingDiffTab(tab: { providerId: string }): boolean {
	return tab.providerId === DIFF_CODING_PROVIDER;
}

function isRealCodingSessionTab(tab: { providerId: string }): boolean {
	return (
		!isPendingCodingTab(tab) && !isCodingFileTab(tab) && !isCodingDiffTab(tab)
	);
}

export function makePendingCodingTab(repositoryId: string): CodingTab {
	return {
		providerId: PENDING_CODING_PROVIDER,
		sdkSessionId: `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		repositoryId,
		title: "New session",
	};
}

export function makeCodingFileTab(
	repositoryId: string,
	path: string,
	title?: string,
): CodingTab {
	return {
		providerId: FILE_CODING_PROVIDER,
		sdkSessionId: path,
		repositoryId,
		title: title ?? path.split("/").pop() ?? path,
	};
}

export function makeCodingDiffTab(
	repositoryId: string,
	path: string,
	title?: string,
): CodingTab {
	return {
		providerId: DIFF_CODING_PROVIDER,
		sdkSessionId: path,
		repositoryId,
		title: title ?? path.split("/").pop() ?? path,
	};
}

export interface RepositorySearchState {
	query: string;
	sessions: BrowserCodingSessionSummary[];
	nextCursor?: SessionCursor;
}

export interface CodingState {
	appMode: BrowserAppMode;
	focusedRepositoryId: string | undefined;
	focusedSession: FocusedSessionRef | undefined;
	openTabs: CodingTab[];
	repositories: BrowserCodingRepositorySummary[];
	sessionsByRepository: Record<string, BrowserCodingSessionSummary[]>;
	nextCursorByRepository: Record<string, SessionCursor | undefined>;
	searchByRepository: Record<string, RepositorySearchState>;
	archivedSessions: BrowserCodingSessionSummary[];
	archivedNextCursor: SessionCursor | undefined;
	archivedSearchState: RepositorySearchState | undefined;
	repositoriesLoaded: boolean;
	codingModels: BrowserCodingModel[];
	codingModelsLoaded: boolean;
	selectedModelId: string | undefined;
	selectedEffort: EffortLevel | undefined;
	fastTierEnabled: boolean;

	setAppMode(mode: BrowserAppMode): void;
	setFocusedRepository(repositoryId: string | undefined): void;
	setFocusedSession(ref: FocusedSessionRef | undefined): void;
	setRepositories(repositories: BrowserCodingRepositorySummary[]): void;
	setRepositorySessions(
		repositoryId: string,
		sessions: BrowserCodingSessionSummary[],
		nextCursor?: SessionCursor,
	): void;
	appendRepositorySessions(
		repositoryId: string,
		sessions: BrowserCodingSessionSummary[],
		nextCursor?: SessionCursor,
	): void;
	setRepositorySearchResults(
		repositoryId: string,
		query: string,
		sessions: BrowserCodingSessionSummary[],
		nextCursor?: SessionCursor,
	): void;
	appendRepositorySearchResults(
		repositoryId: string,
		query: string,
		sessions: BrowserCodingSessionSummary[],
		nextCursor?: SessionCursor,
	): void;
	clearRepositorySearch(repositoryId: string): void;
	setArchivedSessions(
		sessions: BrowserCodingSessionSummary[],
		nextCursor?: SessionCursor,
	): void;
	appendArchivedSessions(
		sessions: BrowserCodingSessionSummary[],
		nextCursor?: SessionCursor,
	): void;
	setArchivedSearchResults(
		query: string,
		sessions: BrowserCodingSessionSummary[],
		nextCursor?: SessionCursor,
	): void;
	appendArchivedSearchResults(
		query: string,
		sessions: BrowserCodingSessionSummary[],
		nextCursor?: SessionCursor,
	): void;
	clearArchivedSearch(): void;
	upsertSession(
		repositoryId: string,
		session: BrowserCodingSessionSummary,
	): void;
	upsertArchivedSession(session: BrowserCodingSessionSummary): void;
	renameSession(
		repositoryId: string,
		providerId: string,
		sdkSessionId: string,
		title: string,
	): void;
	updateSessionRunStatus(
		providerId: string,
		sdkSessionId: string,
		update: {
			runStatus: BrowserCodingSessionRunStatus;
			lastActive?: number;
			failedAt?: number;
			failureMessage?: string;
		},
	): void;
	openTab(tab: CodingTab): void;
	closeTab(
		providerId: string,
		sdkSessionId: string,
		repositoryId?: string,
	): void;
	updateTabTitle(providerId: string, sdkSessionId: string, title: string): void;
	removeSession(
		repositoryId: string,
		providerId: string,
		sdkSessionId: string,
	): void;
	removeArchivedSession(providerId: string, sdkSessionId: string): void;
	updateRepository(repository: BrowserCodingRepositorySummary): void;
	setCodingModels(models: BrowserCodingModel[]): void;
	setSelectedModelId(modelId: string | undefined): void;
	setSelectedEffort(effort: EffortLevel): void;
	setFastTierEnabled(enabled: boolean): void;
}

function isEffortLevel(value: string): value is EffortLevel {
	return (
		value === "low" ||
		value === "medium" ||
		value === "high" ||
		value === "xhigh" ||
		value === "max"
	);
}

function pickEffortForModel(
	model: BrowserCodingModel,
	requested: EffortLevel | undefined,
): EffortLevel | undefined {
	const supported = model.supportedReasoningEfforts.filter(isEffortLevel);
	if (requested && supported.includes(requested)) {
		return requested;
	}
	if (isEffortLevel(model.defaultReasoningEffort)) {
		return model.defaultReasoningEffort;
	}
	return supported[0];
}

const storageKey = CODING_STORAGE_KEY;

const fallbackStorage: StateStorage = {
	getItem: () => null,
	setItem: () => {},
	removeItem: () => {},
};

function safeStorage(): StateStorage {
	if (typeof window === "undefined") {
		return fallbackStorage;
	}
	return window.localStorage;
}

/**
 * Removes a tab and reshapes focus to honor the per-repo invariant: the focused
 * repo always keeps at least one visible tab. If the closed tab was the last
 * one in the focused repo we seed a fresh pending tab so the user lands on the
 * new-session composer instead of an empty middle pane. Tabs closed in
 * non-focused repos just disappear.
 */
function removeTabAndPickFocus(
	state: Pick<
		CodingState,
		"openTabs" | "focusedRepositoryId" | "focusedSession"
	>,
	target: { providerId: string; repositoryId?: string; sdkSessionId: string },
): Partial<CodingState> {
	const index = state.openTabs.findIndex(
		(entry) =>
			entry.providerId === target.providerId &&
			entry.sdkSessionId === target.sdkSessionId &&
			(target.repositoryId === undefined ||
				entry.repositoryId === target.repositoryId),
	);
	if (index === -1) {
		return {};
	}
	const closed = state.openTabs[index];
	if (!closed) {
		return {};
	}
	const nextTabs = state.openTabs.filter((_, i) => i !== index);
	const wasFocused =
		state.focusedSession?.providerId === target.providerId &&
		state.focusedSession?.sdkSessionId === target.sdkSessionId;
	const focusedRepoId = state.focusedRepositoryId;
	const focusedRepoNowEmpty =
		focusedRepoId !== undefined &&
		closed.repositoryId === focusedRepoId &&
		!nextTabs.some((tab) => tab.repositoryId === focusedRepoId);
	if (focusedRepoNowEmpty) {
		const replacement = makePendingCodingTab(focusedRepoId);
		return {
			openTabs: [...nextTabs, replacement],
			focusedSession: {
				providerId: replacement.providerId,
				sdkSessionId: replacement.sdkSessionId,
			},
		};
	}
	if (!wasFocused) {
		return { openTabs: nextTabs };
	}
	const after = nextTabs
		.slice(index)
		.find((tab) => tab.repositoryId === closed.repositoryId);
	const before = [...nextTabs.slice(0, index)]
		.reverse()
		.find((tab) => tab.repositoryId === closed.repositoryId);
	const neighbor = after ?? before;
	return {
		openTabs: nextTabs,
		focusedSession: neighbor
			? {
					providerId: neighbor.providerId,
					sdkSessionId: neighbor.sdkSessionId,
				}
			: undefined,
	};
}

function findPendingTabToReplace(
	state: Pick<CodingState, "focusedSession" | "openTabs">,
	tab: CodingTab,
): number {
	if (!isRealCodingSessionTab(tab)) {
		return -1;
	}
	const focusedPendingIndex = state.openTabs.findIndex(
		(entry) =>
			isPendingCodingTab(entry) &&
			entry.repositoryId === tab.repositoryId &&
			entry.providerId === state.focusedSession?.providerId &&
			entry.sdkSessionId === state.focusedSession?.sdkSessionId,
	);
	if (focusedPendingIndex !== -1) {
		return focusedPendingIndex;
	}
	return state.openTabs.findIndex(
		(entry) =>
			isPendingCodingTab(entry) && entry.repositoryId === tab.repositoryId,
	);
}

function openCodingTab(
	state: Pick<CodingState, "focusedSession" | "openTabs">,
	tab: CodingTab,
): CodingTab[] {
	const existingIndex = state.openTabs.findIndex(
		(entry) =>
			entry.providerId === tab.providerId &&
			entry.sdkSessionId === tab.sdkSessionId &&
			entry.repositoryId === tab.repositoryId,
	);
	if (existingIndex !== -1) {
		return state.openTabs.map((entry, index) =>
			index === existingIndex
				? {
						...entry,
						title: tab.title,
						repositoryId: tab.repositoryId,
					}
				: entry,
		);
	}
	const replacementIndex = findPendingTabToReplace(state, tab);
	if (replacementIndex === -1) {
		return [...state.openTabs, tab];
	}
	return state.openTabs.map((entry, index) =>
		index === replacementIndex ? tab : entry,
	);
}

function updateSessionListRunStatus(
	sessions: BrowserCodingSessionSummary[],
	providerId: string,
	sdkSessionId: string,
	update: {
		runStatus: BrowserCodingSessionRunStatus;
		lastActive?: number;
		failedAt?: number;
		failureMessage?: string;
	},
): BrowserCodingSessionSummary[] {
	let changed = false;
	const next = sessions.map((session) => {
		if (
			session.providerId !== providerId ||
			session.sdkSessionId !== sdkSessionId
		) {
			return session;
		}
		changed = true;
		return {
			...session,
			runStatus: update.runStatus,
			lastActive: update.lastActive ?? session.lastActive,
			...(update.failedAt !== undefined ? { failedAt: update.failedAt } : {}),
			...(update.failureMessage !== undefined
				? { failureMessage: update.failureMessage }
				: {}),
		};
	});
	return changed ? next : sessions;
}

function updateSessionMapsRunStatus(
	sessionsByRepository: Record<string, BrowserCodingSessionSummary[]>,
	providerId: string,
	sdkSessionId: string,
	update: {
		runStatus: BrowserCodingSessionRunStatus;
		lastActive?: number;
		failedAt?: number;
		failureMessage?: string;
	},
): Record<string, BrowserCodingSessionSummary[]> {
	let changed = false;
	const entries = Object.entries(sessionsByRepository).map(
		([repositoryId, sessions]) => {
			const nextSessions = updateSessionListRunStatus(
				sessions,
				providerId,
				sdkSessionId,
				update,
			);
			if (nextSessions !== sessions) {
				changed = true;
			}
			return [repositoryId, nextSessions] as const;
		},
	);
	return changed ? Object.fromEntries(entries) : sessionsByRepository;
}

function updateSearchRunStatus(
	searchByRepository: Record<string, RepositorySearchState>,
	providerId: string,
	sdkSessionId: string,
	update: {
		runStatus: BrowserCodingSessionRunStatus;
		lastActive?: number;
		failedAt?: number;
		failureMessage?: string;
	},
): Record<string, RepositorySearchState> {
	let changed = false;
	const entries = Object.entries(searchByRepository).map(
		([repositoryId, search]) => {
			const sessions = updateSessionListRunStatus(
				search.sessions,
				providerId,
				sdkSessionId,
				update,
			);
			if (sessions !== search.sessions) {
				changed = true;
				return [repositoryId, { ...search, sessions }] as const;
			}
			return [repositoryId, search] as const;
		},
	);
	return changed ? Object.fromEntries(entries) : searchByRepository;
}

export const useCodingStore = create<CodingState>()(
	persist(
		(set) => ({
			appMode: "chat",
			focusedRepositoryId: undefined,
			focusedSession: undefined,
			openTabs: [],
			repositories: [],
			sessionsByRepository: {},
			nextCursorByRepository: {},
			searchByRepository: {},
			archivedSessions: [],
			archivedNextCursor: undefined,
			archivedSearchState: undefined,
			repositoriesLoaded: false,
			codingModels: [],
			codingModelsLoaded: false,
			selectedModelId: undefined,
			selectedEffort: undefined,
			fastTierEnabled: false,

			setAppMode(mode) {
				set({ appMode: mode });
			},
			setFocusedRepository(repositoryId) {
				set((state) => {
					if (repositoryId === undefined) {
						return {
							focusedRepositoryId: undefined,
							focusedSession: undefined,
						};
					}
					const currentTab = state.focusedSession
						? state.openTabs.find(
								(entry) =>
									entry.providerId === state.focusedSession?.providerId &&
									entry.sdkSessionId === state.focusedSession?.sdkSessionId,
							)
						: undefined;
					if (currentTab && currentTab.repositoryId === repositoryId) {
						return { focusedRepositoryId: repositoryId };
					}
					const repoTabs = state.openTabs.filter(
						(tab) => tab.repositoryId === repositoryId,
					);
					const fallback = repoTabs[repoTabs.length - 1];
					if (fallback) {
						return {
							focusedRepositoryId: repositoryId,
							focusedSession: {
								providerId: fallback.providerId,
								sdkSessionId: fallback.sdkSessionId,
							},
						};
					}
					const replacement = makePendingCodingTab(repositoryId);
					return {
						focusedRepositoryId: repositoryId,
						openTabs: [...state.openTabs, replacement],
						focusedSession: {
							providerId: replacement.providerId,
							sdkSessionId: replacement.sdkSessionId,
						},
					};
				});
			},
			setFocusedSession(ref) {
				set({ focusedSession: ref });
			},
			setRepositories(repositories) {
				set((state) => {
					const stillExists =
						state.focusedRepositoryId === undefined ||
						repositories.some(
							(entry) =>
								entry.id === state.focusedRepositoryId &&
								entry.status === "active",
						);
					return {
						repositories,
						repositoriesLoaded: true,
						...(stillExists
							? {}
							: {
									focusedRepositoryId: undefined,
									focusedSession: undefined,
								}),
					};
				});
			},
			setRepositorySessions(repositoryId, sessions, nextCursor) {
				set((state) => ({
					sessionsByRepository: {
						...state.sessionsByRepository,
						[repositoryId]: sessions,
					},
					nextCursorByRepository: {
						...state.nextCursorByRepository,
						[repositoryId]: nextCursor,
					},
				}));
			},
			appendRepositorySessions(repositoryId, sessions, nextCursor) {
				set((state) => {
					const existing = state.sessionsByRepository[repositoryId] ?? [];
					return {
						sessionsByRepository: {
							...state.sessionsByRepository,
							[repositoryId]: mergeCodingSessions(existing, sessions),
						},
						nextCursorByRepository: {
							...state.nextCursorByRepository,
							[repositoryId]: nextCursor,
						},
					};
				});
			},
			setRepositorySearchResults(repositoryId, query, sessions, nextCursor) {
				set((state) => ({
					searchByRepository: {
						...state.searchByRepository,
						[repositoryId]: { query, sessions, nextCursor },
					},
				}));
			},
			appendRepositorySearchResults(repositoryId, query, sessions, nextCursor) {
				set((state) => {
					const current = state.searchByRepository[repositoryId];
					if (!current || current.query !== query) {
						return state;
					}
					return {
						searchByRepository: {
							...state.searchByRepository,
							[repositoryId]: {
								query,
								sessions: mergeCodingSessions(current.sessions, sessions),
								nextCursor,
							},
						},
					};
				});
			},
			clearRepositorySearch(repositoryId) {
				set((state) => {
					if (!(repositoryId in state.searchByRepository)) {
						return state;
					}
					const { [repositoryId]: _removed, ...rest } =
						state.searchByRepository;
					return { searchByRepository: rest };
				});
			},
			setArchivedSessions(sessions, nextCursor) {
				set({
					archivedSessions: sessions,
					archivedNextCursor: nextCursor,
				});
			},
			appendArchivedSessions(sessions, nextCursor) {
				set((state) => {
					return {
						archivedSessions: mergeCodingSessions(
							state.archivedSessions,
							sessions,
						),
						archivedNextCursor: nextCursor,
					};
				});
			},
			setArchivedSearchResults(query, sessions, nextCursor) {
				set({
					archivedSearchState: { query, sessions, nextCursor },
				});
			},
			appendArchivedSearchResults(query, sessions, nextCursor) {
				set((state) => {
					const current = state.archivedSearchState;
					if (!current || current.query !== query) {
						return state;
					}
					return {
						archivedSearchState: {
							query,
							sessions: mergeCodingSessions(current.sessions, sessions),
							nextCursor,
						},
					};
				});
			},
			clearArchivedSearch() {
				set({ archivedSearchState: undefined });
			},
			renameSession(repositoryId, providerId, sdkSessionId, title) {
				set((state) => {
					const ref = { providerId, sdkSessionId };
					const sessions = state.sessionsByRepository[repositoryId];
					const nextSessionsByRepository = sessions
						? {
								...state.sessionsByRepository,
								[repositoryId]: renameCodingSessionInList(sessions, ref, title),
							}
						: state.sessionsByRepository;
					const currentSearch = state.searchByRepository[repositoryId];
					const nextSearchByRepository = currentSearch
						? {
								...state.searchByRepository,
								[repositoryId]: {
									...currentSearch,
									sessions: renameCodingSessionInList(
										currentSearch.sessions,
										ref,
										title,
									),
								},
							}
						: state.searchByRepository;
					const nextArchivedSessions = renameCodingSessionInList(
						state.archivedSessions,
						ref,
						title,
					);
					const nextArchivedSearchState = state.archivedSearchState
						? {
								...state.archivedSearchState,
								sessions: renameCodingSessionInList(
									state.archivedSearchState.sessions,
									ref,
									title,
								),
							}
						: state.archivedSearchState;
					const nextOpenTabs = state.openTabs.map((entry) =>
						entry.providerId === providerId &&
						entry.sdkSessionId === sdkSessionId
							? { ...entry, title }
							: entry,
					);
					return {
						sessionsByRepository: nextSessionsByRepository,
						searchByRepository: nextSearchByRepository,
						archivedSessions: nextArchivedSessions,
						archivedSearchState: nextArchivedSearchState,
						openTabs: nextOpenTabs,
					};
				});
			},
			updateSessionRunStatus(providerId, sdkSessionId, update) {
				set((state) => ({
					sessionsByRepository: updateSessionMapsRunStatus(
						state.sessionsByRepository,
						providerId,
						sdkSessionId,
						update,
					),
					searchByRepository: updateSearchRunStatus(
						state.searchByRepository,
						providerId,
						sdkSessionId,
						update,
					),
					archivedSessions: updateSessionListRunStatus(
						state.archivedSessions,
						providerId,
						sdkSessionId,
						update,
					),
					archivedSearchState: state.archivedSearchState
						? {
								...state.archivedSearchState,
								sessions: updateSessionListRunStatus(
									state.archivedSearchState.sessions,
									providerId,
									sdkSessionId,
									update,
								),
							}
						: undefined,
				}));
			},
			upsertSession(repositoryId, session) {
				set((state) => {
					const existing = state.sessionsByRepository[repositoryId] ?? [];
					return {
						sessionsByRepository: {
							...state.sessionsByRepository,
							[repositoryId]: upsertCodingSession(existing, session),
						},
					};
				});
			},
			upsertArchivedSession(session) {
				set((state) => {
					return {
						archivedSessions: upsertCodingSession(
							state.archivedSessions,
							session,
						),
					};
				});
			},
			openTab(tab) {
				set((state) => {
					return {
						openTabs: openCodingTab(state, tab),
						focusedRepositoryId: tab.repositoryId,
						focusedSession: {
							providerId: tab.providerId,
							sdkSessionId: tab.sdkSessionId,
						},
					};
				});
			},
			closeTab(providerId, sdkSessionId, repositoryId) {
				set((state) =>
					removeTabAndPickFocus(state, {
						providerId,
						...(repositoryId ? { repositoryId } : {}),
						sdkSessionId,
					}),
				);
			},
			updateTabTitle(providerId, sdkSessionId, title) {
				set((state) => ({
					openTabs: state.openTabs.map((entry) =>
						entry.providerId === providerId &&
						entry.sdkSessionId === sdkSessionId
							? { ...entry, title }
							: entry,
					),
				}));
			},
			setCodingModels(models) {
				set((state) => {
					if (models.length === 0) {
						return {
							codingModels: [],
							codingModelsLoaded: true,
							selectedModelId: undefined,
							selectedEffort: undefined,
						};
					}
					const persistedId = state.selectedModelId;
					const persistedStillExists =
						persistedId !== undefined &&
						models.some((model) => model.id === persistedId);
					const selectedModel = persistedStillExists
						? models.find((model) => model.id === persistedId)
						: undefined;
					return {
						codingModels: models,
						codingModelsLoaded: true,
						selectedModelId: selectedModel?.id,
						selectedEffort: selectedModel
							? pickEffortForModel(selectedModel, state.selectedEffort)
							: undefined,
					};
				});
			},
			setSelectedModelId(modelId) {
				set((state) => {
					if (modelId === undefined) {
						return {
							selectedModelId: undefined,
							selectedEffort: undefined,
							fastTierEnabled: false,
						};
					}
					const model = state.codingModels.find(
						(entry) => entry.id === modelId,
					);
					if (!model) {
						return state;
					}
					return {
						selectedModelId: model.id,
						selectedEffort: pickEffortForModel(model, state.selectedEffort),
					};
				});
			},
			setSelectedEffort(effort) {
				set((state) => {
					const model = state.codingModels.find(
						(entry) => entry.id === state.selectedModelId,
					);
					if (model && !model.supportedReasoningEfforts.includes(effort)) {
						return state;
					}
					return { selectedEffort: effort };
				});
			},
			setFastTierEnabled(enabled) {
				set({ fastTierEnabled: enabled });
			},
			removeSession(repositoryId, providerId, sdkSessionId) {
				set((state) => {
					const ref = { providerId, sdkSessionId };
					const sessions = state.sessionsByRepository[repositoryId];
					const nextSessionsByRepository = sessions
						? {
								...state.sessionsByRepository,
								[repositoryId]: removeCodingSession(sessions, ref),
							}
						: state.sessionsByRepository;
					const search = state.searchByRepository[repositoryId];
					const nextSearchByRepository = search
						? {
								...state.searchByRepository,
								[repositoryId]: {
									...search,
									sessions: removeCodingSession(search.sessions, ref),
								},
							}
						: state.searchByRepository;
					const tabPatch = removeTabAndPickFocus(state, {
						providerId,
						repositoryId,
						sdkSessionId,
					});
					return {
						sessionsByRepository: nextSessionsByRepository,
						searchByRepository: nextSearchByRepository,
						...tabPatch,
					};
				});
			},
			removeArchivedSession(providerId, sdkSessionId) {
				set((state) => {
					const ref = { providerId, sdkSessionId };
					const nextArchivedSessions = removeCodingSession(
						state.archivedSessions,
						ref,
					);
					const search = state.archivedSearchState;
					const nextArchivedSearchState = search
						? {
								...search,
								sessions: removeCodingSession(search.sessions, ref),
							}
						: state.archivedSearchState;
					return {
						archivedSessions: nextArchivedSessions,
						archivedSearchState: nextArchivedSearchState,
					};
				});
			},
			updateRepository(repository) {
				set((state) => {
					const nextRepositories = [
						repository,
						...state.repositories.filter((entry) => entry.id !== repository.id),
					];
					const stillFocused =
						state.focusedRepositoryId === undefined ||
						(repository.id !== state.focusedRepositoryId &&
							state.repositories.some(
								(entry) =>
									entry.id === state.focusedRepositoryId &&
									entry.status === "active",
							)) ||
						(repository.id === state.focusedRepositoryId &&
							repository.status === "active");
					return {
						repositories: nextRepositories,
						...(stillFocused
							? {}
							: {
									focusedRepositoryId: undefined,
									focusedSession: undefined,
								}),
					};
				});
			},
		}),
		{
			name: storageKey,
			storage: createJSONStorage(safeStorage),
			partialize: (state) => ({
				appMode: state.appMode,
				focusedRepositoryId: state.focusedRepositoryId,
				focusedSession: state.focusedSession,
				openTabs: state.openTabs,
				selectedModelId: state.selectedModelId,
				selectedEffort: state.selectedEffort,
				fastTierEnabled: state.fastTierEnabled,
			}),
		},
	),
);
