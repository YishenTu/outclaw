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
	BrowserCodingSessionSummary,
	SessionCursor,
} from "../../../common/protocol.ts";

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
	upsertSession(
		repositoryId: string,
		session: BrowserCodingSessionSummary,
	): void;
	renameSession(
		repositoryId: string,
		providerId: string,
		sdkSessionId: string,
		title: string,
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
	setCodingModels(models: BrowserCodingModel[]): void;
	setSelectedModelId(modelId: string): void;
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
							(entry) => entry.id === state.focusedRepositoryId,
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
					const seen = new Set(
						existing.map((entry) => `${entry.providerId} ${entry.sdkSessionId}`),
					);
					const merged = [...existing];
					for (const session of sessions) {
						const key = `${session.providerId} ${session.sdkSessionId}`;
						if (seen.has(key)) {
							continue;
						}
						merged.push(session);
						seen.add(key);
					}
					return {
						sessionsByRepository: {
							...state.sessionsByRepository,
							[repositoryId]: merged,
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
					const seen = new Set(
						current.sessions.map(
							(entry) => `${entry.providerId} ${entry.sdkSessionId}`,
						),
					);
					const merged = [...current.sessions];
					for (const session of sessions) {
						const key = `${session.providerId} ${session.sdkSessionId}`;
						if (seen.has(key)) {
							continue;
						}
						merged.push(session);
						seen.add(key);
					}
					return {
						searchByRepository: {
							...state.searchByRepository,
							[repositoryId]: {
								query,
								sessions: merged,
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
			renameSession(repositoryId, providerId, sdkSessionId, title) {
				set((state) => {
					const matches = (entry: BrowserCodingSessionSummary) =>
						entry.providerId === providerId &&
						entry.sdkSessionId === sdkSessionId;
					const sessions = state.sessionsByRepository[repositoryId];
					const nextSessionsByRepository = sessions
						? {
								...state.sessionsByRepository,
								[repositoryId]: sessions.map((entry) =>
									matches(entry) ? { ...entry, title } : entry,
								),
							}
						: state.sessionsByRepository;
					const currentSearch = state.searchByRepository[repositoryId];
					const nextSearchByRepository = currentSearch
						? {
								...state.searchByRepository,
								[repositoryId]: {
									...currentSearch,
									sessions: currentSearch.sessions.map((entry) =>
										matches(entry) ? { ...entry, title } : entry,
									),
								},
							}
						: state.searchByRepository;
					const nextOpenTabs = state.openTabs.map((entry) =>
						entry.providerId === providerId &&
						entry.sdkSessionId === sdkSessionId
							? { ...entry, title }
							: entry,
					);
					return {
						sessionsByRepository: nextSessionsByRepository,
						searchByRepository: nextSearchByRepository,
						openTabs: nextOpenTabs,
					};
				});
			},
			upsertSession(repositoryId, session) {
				set((state) => {
					const existing = state.sessionsByRepository[repositoryId] ?? [];
					const filtered = existing.filter(
						(entry) =>
							!(
								entry.providerId === session.providerId &&
								entry.sdkSessionId === session.sdkSessionId
							),
					);
					return {
						sessionsByRepository: {
							...state.sessionsByRepository,
							[repositoryId]: [session, ...filtered],
						},
					};
				});
			},
			openTab(tab) {
				set((state) => {
					const exists = state.openTabs.some(
						(entry) =>
							entry.providerId === tab.providerId &&
							entry.sdkSessionId === tab.sdkSessionId &&
							entry.repositoryId === tab.repositoryId,
					);
					const nextTabs = exists
						? state.openTabs.map((entry) =>
								entry.providerId === tab.providerId &&
								entry.sdkSessionId === tab.sdkSessionId &&
								entry.repositoryId === tab.repositoryId
									? {
											...entry,
											title: tab.title,
											repositoryId: tab.repositoryId,
										}
									: entry,
							)
						: [...state.openTabs, tab];
					return {
						openTabs: nextTabs,
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
						};
					}
					const persistedId = state.selectedModelId;
					const persistedStillExists =
						persistedId !== undefined &&
						models.some((model) => model.id === persistedId);
					const fallback = models.find((model) => model.isDefault) ?? models[0];
					if (!fallback) {
						return {
							codingModels: models,
							codingModelsLoaded: true,
						};
					}
					const selectedModelId = persistedStillExists
						? (persistedId as string)
						: fallback.id;
					const selectedModel =
						models.find((model) => model.id === selectedModelId) ?? fallback;
					const selectedEffort = pickEffortForModel(
						selectedModel,
						persistedStillExists ? state.selectedEffort : undefined,
					);
					return {
						codingModels: models,
						codingModelsLoaded: true,
						selectedModelId,
						selectedEffort,
					};
				});
			},
			setSelectedModelId(modelId) {
				set((state) => {
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
					const sessions = state.sessionsByRepository[repositoryId];
					const nextSessionsByRepository = sessions
						? {
								...state.sessionsByRepository,
								[repositoryId]: sessions.filter(
									(entry) =>
										!(
											entry.providerId === providerId &&
											entry.sdkSessionId === sdkSessionId
										),
								),
							}
						: state.sessionsByRepository;
					const tabPatch = removeTabAndPickFocus(state, {
						providerId,
						repositoryId,
						sdkSessionId,
					});
					return {
						sessionsByRepository: nextSessionsByRepository,
						...tabPatch,
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
