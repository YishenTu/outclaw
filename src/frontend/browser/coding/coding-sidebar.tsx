import { FolderInput, GitBranch, PanelLeftOpen, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
	BrowserCodingRepositorySummary,
	BrowserCodingSessionSummary,
	SessionCursor,
} from "../../../common/protocol.ts";
import { SidebarNotifications } from "../components/agent-sidebar/sidebar-notifications.tsx";
import { SidebarRuntimeStatus } from "../components/agent-sidebar/sidebar-runtime-status.tsx";
import { RuntimeConfigModalController } from "../components/runtime-config/runtime-config-modal.tsx";
import {
	cloneCodingRepository,
	fetchCodingRepositories,
	fetchCodingSessions,
	pickCodingRepositoryFolder,
	registerCodingRepository,
} from "../lib/api.ts";
import {
	type ArchiveCenterTab,
	ArchivedSessionsItem,
} from "./archived-sessions-item.tsx";
import { ChatCodePillSwitcher } from "./chat-code-pill-switcher.tsx";
import { CodingCloneModal } from "./coding-clone-modal.tsx";
import { type RepositorySearchState, useCodingStore } from "./coding-store.ts";
import { RepositoryItem } from "./repository-item.tsx";

interface CodingSidebarProps {
	repositories: BrowserCodingRepositorySummary[];
	archivedRepositories: BrowserCodingRepositorySummary[];
	trashedRepositories: BrowserCodingRepositorySummary[];
	sessionsByRepository: Record<string, BrowserCodingSessionSummary[]>;
	archivedSessions: BrowserCodingSessionSummary[];
	trashedSessions: BrowserCodingSessionSummary[];
	focusedRepositoryId: string | undefined;
	focusedSession: { providerId: string; sdkSessionId: string } | undefined;
	onSelectRepository(repositoryId: string): void;
	onSelectSession(
		repositoryId: string,
		session: BrowserCodingSessionSummary,
	): void;
	onCreateRepository(repository: BrowserCodingRepositorySummary): void;
	onNewSession?(repositoryId: string): void;
	onArchiveRepository?(repositoryId: string): void;
	onTrashRepository?(repositoryId: string): void;
	onRestoreRepository?(repositoryId: string): void;
	onArchiveSession?(
		repositoryId: string,
		session: { providerId: string; sdkSessionId: string },
	): void;
	onTrashSession?(
		repositoryId: string,
		session: { providerId: string; sdkSessionId: string },
	): void;
	onRestoreSession?(
		repositoryId: string,
		session: { providerId: string; sdkSessionId: string },
	): void;
	onRenameSession?(
		repositoryId: string,
		session: { providerId: string; sdkSessionId: string },
		title: string,
	): void;
	onCollapse?: () => void;
	onActivateCenterPanel?: () => void;
}

interface OpenCodingSidebarSessionFromListParams {
	repositoryId: string;
	session: BrowserCodingSessionSummary;
	onSelectSession(
		repositoryId: string,
		session: BrowserCodingSessionSummary,
	): void;
	onActivateCenterPanel?: () => void;
}

interface StartCodingSidebarSessionFromRepositoryParams {
	repositoryId: string;
	onNewSession?: (repositoryId: string) => void;
	onActivateCenterPanel?: () => void;
}

export function openCodingSidebarSessionFromList({
	repositoryId,
	session,
	onSelectSession,
	onActivateCenterPanel,
}: OpenCodingSidebarSessionFromListParams): void {
	onSelectSession(repositoryId, session);
	onActivateCenterPanel?.();
}

export function startCodingSidebarSessionFromRepository({
	repositoryId,
	onNewSession,
	onActivateCenterPanel,
}: StartCodingSidebarSessionFromRepositoryParams): void {
	if (!onNewSession) {
		return;
	}
	onNewSession(repositoryId);
	onActivateCenterPanel?.();
}

export function shouldLoadArchivedSessionsOnOpen({
	archivedSessionsLoaded,
}: {
	archivedSessionsLoaded: boolean;
}): boolean {
	return !archivedSessionsLoaded;
}

export function shouldLoadTrashedSessionsOnOpen({
	trashedSessionsLoaded,
}: {
	trashedSessionsLoaded: boolean;
}): boolean {
	return !trashedSessionsLoaded;
}

export function CodingSidebar({
	repositories,
	archivedRepositories,
	trashedRepositories,
	sessionsByRepository,
	archivedSessions,
	trashedSessions,
	focusedRepositoryId,
	focusedSession,
	onSelectRepository,
	onSelectSession,
	onCreateRepository,
	onNewSession,
	onArchiveRepository,
	onTrashRepository,
	onRestoreRepository,
	onArchiveSession,
	onTrashSession,
	onRestoreSession,
	onRenameSession,
	onCollapse,
	onActivateCenterPanel,
}: CodingSidebarProps) {
	const [addPanelOpen, setAddPanelOpen] = useState(false);
	const [addingRepository, setAddingRepository] = useState(false);
	const [cloneModalOpen, setCloneModalOpen] = useState(false);
	const [addRepositoryError, setAddRepositoryError] = useState<
		string | undefined
	>();
	const [expandedRepositories, setExpandedRepositories] = useState<
		Record<string, boolean>
	>({});
	const [archivedSessionsModalOpen, setArchivedSessionsModalOpen] =
		useState(false);
	const setAppMode = useCodingStore((state) => state.setAppMode);
	const nextCursorByRepository = useCodingStore(
		(state) => state.nextCursorByRepository,
	);
	const searchByRepository = useCodingStore(
		(state) => state.searchByRepository,
	);
	const archivedNextCursor = useCodingStore(
		(state) => state.archivedNextCursor,
	);
	const archivedSearchState = useCodingStore(
		(state) => state.archivedSearchState,
	);
	const archivedSessionsLoaded = useCodingStore(
		(state) => state.archivedSessionsLoaded,
	);
	const trashedNextCursor = useCodingStore((state) => state.trashedNextCursor);
	const trashedSearchState = useCodingStore(
		(state) => state.trashedSearchState,
	);
	const trashedSessionsLoaded = useCodingStore(
		(state) => state.trashedSessionsLoaded,
	);
	const appendRepositorySessions = useCodingStore(
		(state) => state.appendRepositorySessions,
	);
	const setArchivedSessions = useCodingStore(
		(state) => state.setArchivedSessions,
	);
	const appendArchivedSessions = useCodingStore(
		(state) => state.appendArchivedSessions,
	);
	const setTrashedSessions = useCodingStore(
		(state) => state.setTrashedSessions,
	);
	const appendTrashedSessions = useCodingStore(
		(state) => state.appendTrashedSessions,
	);
	const setRepositorySearchResults = useCodingStore(
		(state) => state.setRepositorySearchResults,
	);
	const appendRepositorySearchResults = useCodingStore(
		(state) => state.appendRepositorySearchResults,
	);
	const clearRepositorySearch = useCodingStore(
		(state) => state.clearRepositorySearch,
	);
	const setArchivedSearchResults = useCodingStore(
		(state) => state.setArchivedSearchResults,
	);
	const appendArchivedSearchResults = useCodingStore(
		(state) => state.appendArchivedSearchResults,
	);
	const clearArchivedSearch = useCodingStore(
		(state) => state.clearArchivedSearch,
	);
	const setRepositories = useCodingStore((state) => state.setRepositories);
	const loadingMoreRepositoriesRef = useRef(new Set<string>());
	const loadingMoreSearchRef = useRef(new Set<string>());
	const loadingArchivedRepositoriesRef = useRef(new Set<string>());
	const loadingMoreArchivedSearchRef = useRef(new Set<string>());
	const loadingTrashedRef = useRef(false);
	const pendingSearchByRepositoryRef = useRef<Record<string, string>>({});
	const pendingArchivedSearchRef = useRef<string | undefined>(undefined);

	useEffect(() => {
		if (!focusedRepositoryId) {
			return;
		}
		setExpandedRepositories((current) =>
			current[focusedRepositoryId]
				? current
				: { ...current, [focusedRepositoryId]: true },
		);
	}, [focusedRepositoryId]);

	const loadMoreSessions = useCallback(
		async (repositoryId: string) => {
			const cursor = nextCursorByRepository[repositoryId];
			if (!cursor || loadingMoreRepositoriesRef.current.has(repositoryId)) {
				return;
			}
			loadingMoreRepositoriesRef.current.add(repositoryId);
			try {
				const page = await fetchCodingSessions({
					cursor,
					limit: 10,
					repositoryId,
				});
				appendRepositorySessions(repositoryId, page.sessions, page.nextCursor);
			} catch (error) {
				console.warn("Failed to load more coding sessions", error);
			} finally {
				loadingMoreRepositoriesRef.current.delete(repositoryId);
			}
		},
		[appendRepositorySessions, nextCursorByRepository],
	);

	const loadArchivedSessions = useCallback(async () => {
		if (loadingArchivedRepositoriesRef.current.has("all")) {
			return;
		}
		loadingArchivedRepositoriesRef.current.add("all");
		try {
			const page = await fetchCodingSessions({
				limit: 10,
				lifecycleStatus: "archived",
			});
			setArchivedSessions(page.sessions, page.nextCursor);
		} catch (error) {
			console.warn("Failed to load archived coding sessions", error);
		} finally {
			loadingArchivedRepositoriesRef.current.delete("all");
		}
	}, [setArchivedSessions]);

	const loadMoreArchivedSessions = useCallback(async () => {
		const cursor = archivedNextCursor;
		if (!cursor || loadingArchivedRepositoriesRef.current.has("all")) {
			return;
		}
		loadingArchivedRepositoriesRef.current.add("all");
		try {
			const page = await fetchCodingSessions({
				cursor,
				limit: 10,
				lifecycleStatus: "archived",
			});
			appendArchivedSessions(page.sessions, page.nextCursor);
		} catch (error) {
			console.warn("Failed to load more archived coding sessions", error);
		} finally {
			loadingArchivedRepositoriesRef.current.delete("all");
		}
	}, [appendArchivedSessions, archivedNextCursor]);

	const searchSessions = useCallback(
		async (repositoryId: string, query: string, cursor?: SessionCursor) => {
			const trimmed = query.trim();
			if (!trimmed) {
				clearRepositorySearch(repositoryId);
				return;
			}
			const loadingKey = `${repositoryId}:${trimmed}`;
			if (cursor && loadingMoreSearchRef.current.has(loadingKey)) {
				return;
			}
			if (cursor) {
				loadingMoreSearchRef.current.add(loadingKey);
			}
			pendingSearchByRepositoryRef.current[repositoryId] = trimmed;
			try {
				const page = await fetchCodingSessions({
					cursor,
					limit: 10,
					query: trimmed,
					repositoryId,
				});
				if (pendingSearchByRepositoryRef.current[repositoryId] !== trimmed) {
					return;
				}
				const resolvedQuery = page.query ?? trimmed;
				if (cursor) {
					appendRepositorySearchResults(
						repositoryId,
						resolvedQuery,
						page.sessions,
						page.nextCursor,
					);
				} else {
					setRepositorySearchResults(
						repositoryId,
						resolvedQuery,
						page.sessions,
						page.nextCursor,
					);
				}
			} catch (error) {
				console.warn("Failed to search coding sessions", error);
			} finally {
				if (cursor) {
					loadingMoreSearchRef.current.delete(loadingKey);
				}
			}
		},
		[
			appendRepositorySearchResults,
			clearRepositorySearch,
			setRepositorySearchResults,
		],
	);

	const searchArchivedSessions = useCallback(
		async (query: string, cursor?: SessionCursor) => {
			const trimmed = query.trim();
			if (!trimmed) {
				clearArchivedSearch();
				return;
			}
			if (cursor && loadingMoreArchivedSearchRef.current.has(trimmed)) {
				return;
			}
			if (cursor) {
				loadingMoreArchivedSearchRef.current.add(trimmed);
			}
			pendingArchivedSearchRef.current = trimmed;
			try {
				const page = await fetchCodingSessions({
					cursor,
					limit: 10,
					lifecycleStatus: "archived",
					query: trimmed,
				});
				if (pendingArchivedSearchRef.current !== trimmed) {
					return;
				}
				const resolvedQuery = page.query ?? trimmed;
				if (cursor) {
					appendArchivedSearchResults(
						resolvedQuery,
						page.sessions,
						page.nextCursor,
					);
				} else {
					setArchivedSearchResults(
						resolvedQuery,
						page.sessions,
						page.nextCursor,
					);
				}
			} catch (error) {
				console.warn("Failed to search archived coding sessions", error);
			} finally {
				if (cursor) {
					loadingMoreArchivedSearchRef.current.delete(trimmed);
				}
			}
		},
		[
			appendArchivedSearchResults,
			clearArchivedSearch,
			setArchivedSearchResults,
		],
	);

	const loadTrashedSessions = useCallback(async () => {
		if (loadingTrashedRef.current) {
			return;
		}
		loadingTrashedRef.current = true;
		try {
			const page = await fetchCodingSessions({
				limit: 10,
				lifecycleStatus: "trashed",
			});
			setTrashedSessions(page.sessions, page.nextCursor);
		} catch (error) {
			console.warn("Failed to load trashed coding sessions", error);
		} finally {
			loadingTrashedRef.current = false;
		}
	}, [setTrashedSessions]);

	const loadMoreTrashedSessions = useCallback(async () => {
		const cursor = trashedNextCursor;
		if (!cursor || loadingTrashedRef.current) {
			return;
		}
		loadingTrashedRef.current = true;
		try {
			const page = await fetchCodingSessions({
				cursor,
				limit: 10,
				lifecycleStatus: "trashed",
			});
			appendTrashedSessions(page.sessions, page.nextCursor);
		} catch (error) {
			console.warn("Failed to load more trashed coding sessions", error);
		} finally {
			loadingTrashedRef.current = false;
		}
	}, [appendTrashedSessions, trashedNextCursor]);

	const openArchivedSessions = useCallback(() => {
		setArchivedSessionsModalOpen(true);
		if (shouldLoadArchivedSessionsOnOpen({ archivedSessionsLoaded })) {
			void loadArchivedSessions();
		}
		if (shouldLoadTrashedSessionsOnOpen({ trashedSessionsLoaded })) {
			void loadTrashedSessions();
		}
	}, [
		archivedSessionsLoaded,
		loadArchivedSessions,
		loadTrashedSessions,
		trashedSessionsLoaded,
	]);

	const closeArchivedSessions = useCallback(() => {
		setArchivedSessionsModalOpen(false);
	}, []);

	const refreshArchiveCenter = useCallback(
		(tab: ArchiveCenterTab) => {
			if (tab === "sessions") {
				void loadArchivedSessions();
				return;
			}
			if (tab === "trash") {
				void loadTrashedSessions();
				return;
			}
			// Projects tab: refetch the full repository list (including archived
			// and trashed) so the modal sees Codex-side renames or status flips
			// from the CLI without waiting for the next visibility change.
			void fetchCodingRepositories({
				includeArchived: true,
				includeTrashed: true,
			})
				.then((result) => setRepositories(result.repositories))
				.catch((error) => {
					console.warn("Failed to refresh coding repositories", error);
				});
		},
		[loadArchivedSessions, loadTrashedSessions, setRepositories],
	);

	const closeAddPanel = useCallback(() => {
		setAddPanelOpen(false);
		setAddRepositoryError(undefined);
	}, []);

	const handlePickExistingFolder = useCallback(async () => {
		if (addingRepository) {
			return;
		}
		setAddingRepository(true);
		setAddRepositoryError(undefined);
		try {
			const picked = await pickCodingRepositoryFolder();
			if (picked.status === "canceled") {
				return;
			}
			if (picked.status === "unavailable") {
				setAddRepositoryError(picked.message);
				return;
			}
			const repository = await registerCodingRepository({
				rootCwd: picked.path,
				source: "manual",
			});
			onCreateRepository(repository);
			closeAddPanel();
		} catch (error) {
			setAddRepositoryError(
				error instanceof Error ? error.message : String(error),
			);
		} finally {
			setAddingRepository(false);
		}
	}, [addingRepository, onCreateRepository, closeAddPanel]);

	const handleOpenCloneModal = useCallback(() => {
		setAddRepositoryError(undefined);
		setCloneModalOpen(true);
	}, []);

	const handleBrowseCloneLocation = useCallback(async () => {
		const picked = await pickCodingRepositoryFolder();
		if (picked.status === "selected") {
			return picked.path;
		}
		if (picked.status === "unavailable") {
			throw new Error(picked.message);
		}
		return undefined;
	}, []);

	const handleSubmitClone = useCallback(
		async ({
			remoteUrl,
			parentDir,
		}: {
			remoteUrl: string;
			parentDir: string;
		}): Promise<{ ok: true } | { ok: false; message: string }> => {
			const result = await cloneCodingRepository({ remoteUrl, parentDir });
			if (result.status === "failed") {
				return { ok: false, message: result.message };
			}
			onCreateRepository(result.repository);
			setCloneModalOpen(false);
			closeAddPanel();
			return { ok: true };
		},
		[closeAddPanel, onCreateRepository],
	);

	return (
		<RuntimeConfigModalController>
			{({ configOpen, onRestart, onToggleConfig }) => (
				<div className="relative flex h-full flex-col bg-dark-950">
					<div className="relative flex h-12 items-center justify-center border-b border-dark-800 px-3">
						<img
							src="/Sidebar%20Banner.png"
							alt="OUTCLAW"
							className="h-7 w-auto shrink-0 -translate-x-3"
						/>
						{onCollapse && (
							<button
								type="button"
								onClick={onCollapse}
								className="absolute right-3 flex items-center justify-center text-dark-500 transition-colors hover:text-dark-100"
								aria-label="Collapse left sidebar"
							>
								<PanelLeftOpen size={15} />
							</button>
						)}
					</div>

					<div className="flex h-8 shrink-0 items-center border-b border-dark-800 px-3">
						<ChatCodePillSwitcher
							active="code"
							onSelect={(mode) => {
								if (mode === "chat") {
									setAppMode("chat");
								}
							}}
						/>
					</div>

					<div className="scrollbar-none flex-1 overflow-y-auto overflow-x-hidden px-3 py-3">
						{repositories.length === 0 ? (
							<div className="border border-dashed border-dark-800 px-4 py-5 text-sm text-dark-500">
								No active repositories. Add one with the + button to start a
								coding session.
							</div>
						) : (
							repositories.map((repository) => {
								const sessions = sessionsByRepository[repository.id] ?? [];
								const isExpanded = expandedRepositories[repository.id] ?? false;
								const searchState: RepositorySearchState | undefined =
									searchByRepository[repository.id];
								const nextCursor = nextCursorByRepository[repository.id];
								return (
									<RepositoryItem
										key={repository.id}
										repository={{
											id: repository.id,
											displayName: repository.displayName,
										}}
										isExpanded={isExpanded}
										{...(focusedRepositoryId === repository.id && focusedSession
											? { focusedSession }
											: {})}
										sessions={sessions}
										{...(nextCursor ? { nextCursor } : {})}
										{...(searchState ? { searchState } : {})}
										onToggle={() =>
											setExpandedRepositories((current) => ({
												...current,
												[repository.id]: !(current[repository.id] ?? false),
											}))
										}
										onSelectRepository={() => onSelectRepository(repository.id)}
										onNewSession={() =>
											startCodingSidebarSessionFromRepository({
												repositoryId: repository.id,
												onNewSession,
												onActivateCenterPanel,
											})
										}
										onArchiveRepository={() =>
											onArchiveRepository?.(repository.id)
										}
										onTrashRepository={() => onTrashRepository?.(repository.id)}
										onSelectSession={(session) =>
											openCodingSidebarSessionFromList({
												repositoryId: repository.id,
												session,
												onSelectSession,
												onActivateCenterPanel,
											})
										}
										onRenameSession={(session, title) =>
											onRenameSession?.(
												repository.id,
												{
													providerId: session.providerId,
													sdkSessionId: session.sdkSessionId,
												},
												title,
											)
										}
										onArchiveSession={(session) =>
											onArchiveSession?.(repository.id, {
												providerId: session.providerId,
												sdkSessionId: session.sdkSessionId,
											})
										}
										onTrashSession={(session) =>
											onTrashSession?.(repository.id, {
												providerId: session.providerId,
												sdkSessionId: session.sdkSessionId,
											})
										}
										onLoadMore={() => loadMoreSessions(repository.id)}
										onSearch={(query) => searchSessions(repository.id, query)}
										onLoadMoreSearch={(query) =>
											searchSessions(
												repository.id,
												query,
												searchByRepository[repository.id]?.nextCursor,
											)
										}
										onClearSearch={() => {
											delete pendingSearchByRepositoryRef.current[
												repository.id
											];
											clearRepositorySearch(repository.id);
										}}
									/>
								);
							})
						)}
					</div>

					{addPanelOpen && (
						<div className="flex shrink-0 flex-col gap-2 border-t border-dark-800 bg-dark-900/40 px-3 py-2.5">
							<button
								type="button"
								onClick={handlePickExistingFolder}
								disabled={addingRepository}
								className="flex items-center gap-2 rounded-md border border-dark-800 bg-dark-950 px-3 py-2 text-left text-dark-200 transition-colors hover:border-dark-700 hover:text-dark-100 disabled:cursor-not-allowed disabled:opacity-60"
							>
								<FolderInput size={13} className="shrink-0" />
								<span className="font-mono-ui text-[11px] uppercase tracking-[0.16em]">
									{addingRepository
										? "Picking folder…"
										: "Pick existing folder"}
								</span>
							</button>
							<button
								type="button"
								onClick={handleOpenCloneModal}
								disabled={addingRepository}
								className="flex items-center gap-2 rounded-md border border-dark-800 bg-dark-950 px-3 py-2 text-left text-dark-200 transition-colors hover:border-dark-700 hover:text-dark-100 disabled:cursor-not-allowed disabled:opacity-60"
							>
								<GitBranch size={13} className="shrink-0" />
								<span className="font-mono-ui text-[11px] uppercase tracking-[0.16em]">
									Clone from URL
								</span>
							</button>
						</div>
					)}

					{addRepositoryError && (
						<div className="shrink-0 border-t border-dark-800 bg-dark-900/40 px-4 py-2 text-[11px] text-danger">
							{addRepositoryError}
						</div>
					)}

					<SidebarNotifications />

					<div className="grid shrink-0 grid-cols-2 border-t border-dark-800">
						<button
							type="button"
							onClick={() => {
								if (addPanelOpen) {
									closeAddPanel();
								} else {
									setAddPanelOpen(true);
								}
							}}
							disabled={addingRepository}
							aria-expanded={addPanelOpen}
							className="flex min-w-0 items-center justify-center gap-2 px-3 py-2 text-dark-400 transition-colors hover:bg-dark-900/40 hover:text-dark-100 disabled:cursor-not-allowed disabled:opacity-60"
						>
							{addPanelOpen ? (
								<X size={13} className="shrink-0" />
							) : (
								<Plus size={13} className="shrink-0" />
							)}
							<span className="font-mono-ui min-w-0 truncate text-[11px] uppercase tracking-[0.16em]">
								{addPanelOpen ? "Cancel" : "Add repo"}
							</span>
						</button>
						<ArchivedSessionsItem
							isOpen={archivedSessionsModalOpen}
							repositories={[
								...repositories,
								...archivedRepositories,
								...trashedRepositories,
							]}
							archivedRepositories={archivedRepositories}
							trashedRepositories={trashedRepositories}
							triggerClassName="flex min-w-0 items-center justify-center gap-2 border-l border-dark-800 px-3 py-2 text-dark-400 transition-colors hover:bg-dark-900/40 hover:text-dark-100"
							sessionsTab={{
								sessions: archivedSessions,
								emptyLabel: "No archived sessions.",
								missingMatchLabel: "No matching archived sessions.",
								loadMoreLabel: "Load more archived sessions",
								loadMoreSearchLabel: "Load more archived results",
								searchPlaceholder: "Search archived sessions",
								...(archivedNextCursor
									? { nextCursor: archivedNextCursor }
									: {}),
								...(archivedSearchState
									? { searchState: archivedSearchState }
									: {}),
								onSelectSession: (session) => {
									if (session.repositoryId) {
										openCodingSidebarSessionFromList({
											repositoryId: session.repositoryId,
											session,
											onSelectSession,
											onActivateCenterPanel,
										});
										setArchivedSessionsModalOpen(false);
									}
								},
								onRenameSession: (session, title) => {
									if (session.repositoryId) {
										onRenameSession?.(
											session.repositoryId,
											{
												providerId: session.providerId,
												sdkSessionId: session.sdkSessionId,
											},
											title,
										);
									}
								},
								onRestoreSession: (session) => {
									if (session.repositoryId) {
										onRestoreSession?.(session.repositoryId, {
											providerId: session.providerId,
											sdkSessionId: session.sdkSessionId,
										});
									}
								},
								onLoadMore: loadMoreArchivedSessions,
								onSearch: searchArchivedSessions,
								onLoadMoreSearch: (query) =>
									searchArchivedSessions(
										query,
										archivedSearchState?.nextCursor,
									),
								onClearSearch: () => {
									pendingArchivedSearchRef.current = undefined;
									clearArchivedSearch();
								},
							}}
							trashTab={{
								sessions: trashedSessions,
								emptyLabel: "Trash is empty.",
								missingMatchLabel: "No matching trashed sessions.",
								loadMoreLabel: "Load more trashed sessions",
								loadMoreSearchLabel: "Load more trashed results",
								...(trashedNextCursor ? { nextCursor: trashedNextCursor } : {}),
								...(trashedSearchState
									? { searchState: trashedSearchState }
									: {}),
								onSelectSession: (session) => {
									if (session.repositoryId) {
										openCodingSidebarSessionFromList({
											repositoryId: session.repositoryId,
											session,
											onSelectSession,
											onActivateCenterPanel,
										});
										setArchivedSessionsModalOpen(false);
									}
								},
								onRenameSession: (session, title) => {
									if (session.repositoryId) {
										onRenameSession?.(
											session.repositoryId,
											{
												providerId: session.providerId,
												sdkSessionId: session.sdkSessionId,
											},
											title,
										);
									}
								},
								onRestoreSession: (session) => {
									if (session.repositoryId) {
										onRestoreSession?.(session.repositoryId, {
											providerId: session.providerId,
											sdkSessionId: session.sdkSessionId,
										});
									}
								},
								onLoadMore: loadMoreTrashedSessions,
							}}
							onRestoreRepository={(repositoryId) =>
								onRestoreRepository?.(repositoryId)
							}
							onOpen={openArchivedSessions}
							onClose={closeArchivedSessions}
							onRefresh={refreshArchiveCenter}
						/>
					</div>

					{cloneModalOpen && (
						<CodingCloneModal
							onBrowseLocation={handleBrowseCloneLocation}
							onClone={handleSubmitClone}
							onClose={() => setCloneModalOpen(false)}
						/>
					)}

					<SidebarRuntimeStatus
						configOpen={configOpen}
						onToggleConfig={onToggleConfig}
						onRestart={onRestart}
					/>
				</div>
			)}
		</RuntimeConfigModalController>
	);
}
