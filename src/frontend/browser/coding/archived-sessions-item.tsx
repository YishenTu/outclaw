import { Archive, ChevronDown, RefreshCw, Search, X } from "lucide-react";
import { type Ref, useEffect, useMemo, useRef, useState } from "react";
import type {
	BrowserCodingRepositorySummary,
	BrowserCodingSessionSummary,
	SessionCursor,
} from "../../../common/protocol.ts";
import { SessionItem } from "../components/agent-sidebar/session-item.tsx";

export type ArchiveCenterTab = "sessions" | "trash" | "projects";

interface ArchivedSessionSearchState {
	query: string;
	sessions: BrowserCodingSessionSummary[];
	nextCursor?: SessionCursor;
}

interface ArchiveSessionsTabProps {
	sessions: BrowserCodingSessionSummary[];
	nextCursor?: SessionCursor;
	searchState?: ArchivedSessionSearchState;
	emptyLabel: string;
	missingMatchLabel: string;
	loadMoreLabel: string;
	loadMoreSearchLabel: string;
	searchPlaceholder?: string;
	onSelectSession: (session: BrowserCodingSessionSummary) => void;
	onRenameSession: (
		session: BrowserCodingSessionSummary,
		title: string,
	) => void;
	onRestoreSession: (session: BrowserCodingSessionSummary) => void;
	onLoadMore: () => void;
	onLoadMoreSearch?: (query: string) => void;
	onSearch?: (query: string) => void;
	onClearSearch?: () => void;
}

interface ArchivedSessionsItemProps {
	isOpen: boolean;
	repositories: BrowserCodingRepositorySummary[];

	sessionsTab: ArchiveSessionsTabProps;
	trashTab: ArchiveSessionsTabProps;

	archivedRepositories: BrowserCodingRepositorySummary[];
	trashedRepositories: BrowserCodingRepositorySummary[];
	onRestoreRepository: (repositoryId: string) => void;

	triggerClassName?: string;
	triggerLabel?: string;
	onOpen: () => void;
	onClose: () => void;
	onRefresh: (tab: ArchiveCenterTab) => void;
}

interface ArchivedSessionProjectGroup {
	key: string;
	label: string;
	sessions: BrowserCodingSessionSummary[];
}

export function shouldObserveArchivedLoadMore({
	hasNextCursor,
	intersectionObserverAvailable,
	isOpen,
}: {
	hasNextCursor: boolean;
	intersectionObserverAvailable: boolean;
	isOpen: boolean;
}): boolean {
	return isOpen && hasNextCursor && intersectionObserverAvailable;
}

export function createArchivedLoadMoreRequestKey({
	cursor,
	searchQuery,
	scope = "archive",
}: {
	cursor: SessionCursor | undefined;
	searchQuery?: string;
	scope?: "archive" | "trash";
}): string | undefined {
	if (!cursor) {
		return undefined;
	}
	const query = searchQuery?.trim();
	const effectiveScope = query ? `search:${scope}:${query}` : scope;
	return `${effectiveScope}:${cursor.lastActive}:${cursor.sdkSessionId}`;
}

export function shouldRequestObservedArchivedLoadMore({
	isIntersecting,
	lastRequestedKey,
	requestKey,
}: {
	isIntersecting: boolean;
	lastRequestedKey: string | undefined;
	requestKey: string | undefined;
}): boolean {
	return (
		isIntersecting && Boolean(requestKey) && requestKey !== lastRequestedKey
	);
}

type ArchivedSearchSubmission =
	| { type: "clear" }
	| { query: string; type: "search" }
	| { type: "none" };

export function resolveArchivedSearchSubmission({
	currentSearchQuery,
	draftQuery,
	lastSubmittedQuery,
}: {
	currentSearchQuery: string | undefined;
	draftQuery: string;
	lastSubmittedQuery: string | undefined;
}): ArchivedSearchSubmission {
	const query = draftQuery.trim();
	const current = currentSearchQuery?.trim();
	const lastSubmitted = lastSubmittedQuery?.trim();
	if (!query) {
		return current || lastSubmitted ? { type: "clear" } : { type: "none" };
	}
	if (query === current || query === lastSubmitted) {
		return { type: "none" };
	}
	return { query, type: "search" };
}

export function ArchivedSessionsItem({
	isOpen,
	repositories,
	sessionsTab,
	trashTab,
	archivedRepositories,
	trashedRepositories,
	onRestoreRepository,
	triggerClassName = "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm text-dark-500 transition-colors hover:text-dark-300",
	triggerLabel = "Archive",
	onOpen,
	onClose,
	onRefresh,
}: ArchivedSessionsItemProps) {
	const [activeTab, setActiveTab] = useState<ArchiveCenterTab>("sessions");

	useEffect(() => {
		if (!isOpen) {
			return;
		}

		function handleKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				event.preventDefault();
				onClose();
			}
		}

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isOpen, onClose]);

	return (
		<>
			<button
				type="button"
				aria-label="Open archive center"
				aria-haspopup="dialog"
				aria-expanded={isOpen}
				onClick={onOpen}
				className={triggerClassName}
			>
				<Archive size={13} className="shrink-0" />
				<span className="font-mono-ui min-w-0 truncate text-[11px] uppercase tracking-[0.16em]">
					{triggerLabel}
				</span>
			</button>

			{isOpen && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-dark-950/80 px-4 py-6 backdrop-blur-sm"
					onPointerDown={(event) => {
						if (event.target === event.currentTarget) {
							onClose();
						}
					}}
				>
					<div
						role="dialog"
						aria-label="Archive center"
						aria-modal="true"
						className="flex max-h-[min(760px,calc(100vh-48px))] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-dark-800 bg-dark-950 shadow-2xl shadow-black/50"
					>
						<div className="flex items-center justify-between gap-3 bg-dark-900/40 px-5 py-4">
							<div className="flex items-center gap-2 text-dark-50">
								<Archive size={16} className="shrink-0 text-dark-300" />
								<div className="font-display text-[15px] font-semibold tracking-[0.01em]">
									Archive
								</div>
							</div>
							<div className="flex items-center gap-1">
								<button
									type="button"
									onClick={() => onRefresh(activeTab)}
									aria-label="Refresh from Codex"
									className="rounded p-1 text-dark-500 transition-colors hover:bg-dark-800/60 hover:text-dark-100"
								>
									<RefreshCw size={14} />
								</button>
								<button
									type="button"
									onClick={onClose}
									aria-label="Close archive center"
									className="rounded p-1 text-dark-500 transition-colors hover:bg-dark-800/60 hover:text-dark-100"
								>
									<X size={16} />
								</button>
							</div>
						</div>

						<div className="flex shrink-0 gap-1 border-b border-dark-800 px-4 pt-2 pb-1">
							<TabButton
								active={activeTab === "sessions"}
								onClick={() => setActiveTab("sessions")}
							>
								Sessions
							</TabButton>
							<TabButton
								active={activeTab === "trash"}
								onClick={() => setActiveTab("trash")}
							>
								Trash
							</TabButton>
							<TabButton
								active={activeTab === "projects"}
								onClick={() => setActiveTab("projects")}
							>
								Projects
							</TabButton>
						</div>

						{activeTab === "sessions" && (
							<ArchiveSessionsList
								tab={sessionsTab}
								repositories={repositories}
								isOpen={isOpen}
								scope="archive"
							/>
						)}
						{activeTab === "trash" && (
							<ArchiveSessionsList
								tab={trashTab}
								repositories={repositories}
								isOpen={isOpen}
								scope="trash"
							/>
						)}
						{activeTab === "projects" && (
							<ProjectsTab
								archivedRepositories={archivedRepositories}
								trashedRepositories={trashedRepositories}
								onRestoreRepository={onRestoreRepository}
							/>
						)}
					</div>
				</div>
			)}
		</>
	);
}

function TabButton({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			role="tab"
			aria-selected={active}
			onClick={onClick}
			className={
				active
					? "rounded-t border-b-2 border-dark-100 bg-dark-900/40 px-3 py-1.5 font-mono-ui text-[11px] uppercase tracking-[0.16em] text-dark-50"
					: "rounded-t border-b-2 border-transparent px-3 py-1.5 font-mono-ui text-[11px] uppercase tracking-[0.16em] text-dark-500 transition-colors hover:text-dark-200"
			}
		>
			{children}
		</button>
	);
}

function ArchiveSessionsList({
	tab,
	repositories,
	isOpen,
	scope,
}: {
	tab: ArchiveSessionsTabProps;
	repositories: BrowserCodingRepositorySummary[];
	isOpen: boolean;
	scope: "archive" | "trash";
}) {
	const searchEnabled = Boolean(
		tab.onSearch && tab.onLoadMoreSearch && tab.onClearSearch,
	);
	const [draftSearch, setDraftSearch] = useState(tab.searchState?.query ?? "");
	const searchInputRef = useRef<HTMLInputElement | null>(null);
	const loadMoreRef = useRef<HTMLDivElement | null>(null);
	const observedLoadMoreRequestKeyRef = useRef<string | undefined>(undefined);
	const lastSubmittedSearchRef = useRef<string | undefined>(
		tab.searchState?.query,
	);
	const effectiveSearchQuery = draftSearch.trim();
	const searchActive = isOpen && effectiveSearchQuery !== "" && searchEnabled;
	const visibleSearchResults =
		searchActive && tab.searchState?.query === effectiveSearchQuery
			? tab.searchState.sessions
			: [];
	const visibleSessions = searchActive ? visibleSearchResults : tab.sessions;
	const visibleNextCursor = searchActive
		? tab.searchState?.nextCursor
		: tab.nextCursor;
	const visibleLoadMoreRequestKey = createArchivedLoadMoreRequestKey({
		cursor: visibleNextCursor,
		searchQuery: searchActive ? effectiveSearchQuery : undefined,
		scope,
	});
	const groupedSessions = useMemo(
		() => groupSessionsByProject(visibleSessions, repositories),
		[repositories, visibleSessions],
	);

	useEffect(() => {
		if (!searchEnabled) {
			return;
		}
		const query = tab.searchState?.query;
		if (!query) {
			return;
		}
		lastSubmittedSearchRef.current = query;
		setDraftSearch((current) => {
			if (!isOpen || !current.trim() || current.trim() === query) {
				return query;
			}
			return current;
		});
	}, [isOpen, searchEnabled, tab.searchState?.query]);

	useEffect(() => {
		if (!isOpen || !searchEnabled) {
			observedLoadMoreRequestKeyRef.current = undefined;
			return;
		}
		const frameId = window.requestAnimationFrame(() => {
			searchInputRef.current?.focus();
		});
		return () => window.cancelAnimationFrame(frameId);
	}, [isOpen, searchEnabled]);

	useEffect(() => {
		if (!isOpen || !searchEnabled) {
			return;
		}
		const submission = resolveArchivedSearchSubmission({
			currentSearchQuery: tab.searchState?.query,
			draftQuery: draftSearch,
			lastSubmittedQuery: lastSubmittedSearchRef.current,
		});
		if (submission.type === "none") {
			return;
		}
		const timer = setTimeout(() => {
			if (submission.type === "clear") {
				lastSubmittedSearchRef.current = undefined;
				tab.onClearSearch?.();
				return;
			}
			lastSubmittedSearchRef.current = submission.query;
			tab.onSearch?.(submission.query);
		}, 150);
		return () => clearTimeout(timer);
	}, [draftSearch, isOpen, searchEnabled, tab]);

	useEffect(() => {
		if (
			!shouldObserveArchivedLoadMore({
				hasNextCursor: Boolean(visibleNextCursor),
				intersectionObserverAvailable:
					typeof IntersectionObserver !== "undefined",
				isOpen,
			})
		) {
			return;
		}
		const element = loadMoreRef.current;
		if (!element) {
			return;
		}
		const requestKey = visibleLoadMoreRequestKey;
		const observer = new IntersectionObserver((entries) => {
			const isIntersecting = entries.some((entry) => entry.isIntersecting);
			if (
				!shouldRequestObservedArchivedLoadMore({
					isIntersecting,
					lastRequestedKey: observedLoadMoreRequestKeyRef.current,
					requestKey,
				})
			) {
				return;
			}
			observedLoadMoreRequestKeyRef.current = requestKey;
			if (searchActive) {
				tab.onLoadMoreSearch?.(effectiveSearchQuery);
			} else {
				tab.onLoadMore();
			}
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, [
		effectiveSearchQuery,
		isOpen,
		searchActive,
		tab,
		visibleLoadMoreRequestKey,
		visibleNextCursor,
	]);

	function renderSession(session: BrowserCodingSessionSummary) {
		const title = session.title || session.sdkSessionId;
		return (
			<SessionItem
				key={`${session.providerId}:${session.sdkSessionId}`}
				title={title}
				lastActive={session.lastActive}
				isActive={false}
				onSelect={() => tab.onSelectSession(session)}
				onRename={(nextTitle) => tab.onRenameSession(session, nextTitle)}
				onDelete={() => tab.onRestoreSession(session)}
				actionAriaLabel={`Restore session ${title}`}
				actionIcon="restore"
				actionLabel="Restore"
				actionRequiresConfirmation={false}
				actionTone="neutral"
				actionVisibility="always"
			/>
		);
	}

	return (
		<>
			{searchEnabled && (
				<div className="border-b border-dark-800 px-5 py-3">
					<label className="flex items-center gap-2 rounded-md border border-dark-700 bg-dark-950 px-3 py-2 text-sm text-dark-100 transition-colors focus-within:border-dark-500">
						<Search size={14} className="shrink-0 text-dark-500" />
						<input
							ref={searchInputRef}
							value={draftSearch}
							onChange={(event) => {
								observedLoadMoreRequestKeyRef.current = undefined;
								setDraftSearch(event.target.value);
							}}
							placeholder={tab.searchPlaceholder ?? "Search"}
							spellCheck={false}
							className="min-w-0 flex-1 bg-transparent text-sm text-dark-50 outline-none placeholder:text-dark-600"
						/>
					</label>
				</div>
			)}

			<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
				{groupedSessions.length === 0 ? (
					<div className="px-3 py-2 text-sm text-dark-500">
						{searchActive ? tab.missingMatchLabel : tab.emptyLabel}
					</div>
				) : (
					<div className="space-y-4">
						{groupedSessions.map((group) => (
							<section key={group.key} className="space-y-1">
								<div className="px-2 font-mono-ui text-[10px] uppercase tracking-[0.16em] text-dark-500">
									{group.label}
								</div>
								<div className="space-y-0.5">
									{group.sessions.map(renderSession)}
								</div>
							</section>
						))}
						{visibleNextCursor && (
							<LoadMoreButton
								containerRef={loadMoreRef}
								label={
									searchActive ? tab.loadMoreSearchLabel : tab.loadMoreLabel
								}
								onClick={() => {
									if (searchActive) {
										tab.onLoadMoreSearch?.(effectiveSearchQuery);
									} else {
										tab.onLoadMore();
									}
								}}
							/>
						)}
					</div>
				)}
			</div>
		</>
	);
}

function ProjectsTab({
	archivedRepositories,
	trashedRepositories,
	onRestoreRepository,
}: {
	archivedRepositories: BrowserCodingRepositorySummary[];
	trashedRepositories: BrowserCodingRepositorySummary[];
	onRestoreRepository: (repositoryId: string) => void;
}) {
	const empty =
		archivedRepositories.length === 0 && trashedRepositories.length === 0;
	return (
		<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
			{empty ? (
				<div className="px-3 py-2 text-sm text-dark-500">
					No archived or trashed projects.
				</div>
			) : (
				<div className="space-y-4">
					{archivedRepositories.length > 0 && (
						<RepositorySection
							label="Archived"
							repositories={archivedRepositories}
							onRestore={onRestoreRepository}
						/>
					)}
					{trashedRepositories.length > 0 && (
						<RepositorySection
							label="Trash"
							repositories={trashedRepositories}
							onRestore={onRestoreRepository}
						/>
					)}
				</div>
			)}
		</div>
	);
}

function RepositorySection({
	label,
	repositories,
	onRestore,
}: {
	label: string;
	repositories: BrowserCodingRepositorySummary[];
	onRestore: (repositoryId: string) => void;
}) {
	return (
		<section className="space-y-1">
			<div className="px-2 font-mono-ui text-[10px] uppercase tracking-[0.16em] text-dark-500">
				{label}
			</div>
			<div className="space-y-0.5">
				{repositories.map((repository) => (
					<div
						key={repository.id}
						className="flex items-center gap-2 rounded px-2 py-1 text-sm text-dark-200"
					>
						<div className="min-w-0 flex-1 truncate">
							{repository.displayName}
						</div>
						<button
							type="button"
							aria-label={`Restore repository ${repository.displayName}`}
							onClick={() => onRestore(repository.id)}
							className="font-mono-ui shrink-0 rounded border border-dark-700 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-dark-300 transition-colors hover:border-dark-500 hover:text-dark-50"
						>
							Restore
						</button>
					</div>
				))}
			</div>
		</section>
	);
}

function groupSessionsByProject(
	sessions: BrowserCodingSessionSummary[],
	repositories: BrowserCodingRepositorySummary[],
): ArchivedSessionProjectGroup[] {
	const repositoriesById = new Map(
		repositories.map((repository) => [repository.id, repository]),
	);
	const groups: ArchivedSessionProjectGroup[] = [];
	const groupsByKey = new Map<string, ArchivedSessionProjectGroup>();
	for (const session of sessions) {
		const project = describeSessionProject(session, repositoriesById);
		let group = groupsByKey.get(project.key);
		if (!group) {
			group = {
				key: project.key,
				label: project.label,
				sessions: [],
			};
			groupsByKey.set(project.key, group);
			groups.push(group);
		}
		group.sessions.push(session);
	}
	return groups;
}

function describeSessionProject(
	session: BrowserCodingSessionSummary,
	repositoriesById: Map<string, BrowserCodingRepositorySummary>,
): { key: string; label: string } {
	if (session.repositoryId) {
		const repository = repositoriesById.get(session.repositoryId);
		if (repository) {
			return { key: repository.id, label: repository.displayName };
		}
		return { key: session.repositoryId, label: "Unknown project" };
	}
	const cwdParts = session.cwd.split(/[\\/]/).filter(Boolean);
	const folderName = cwdParts[cwdParts.length - 1];
	return {
		key: session.cwd || "unassigned",
		label: folderName || "Unassigned project",
	};
}

function LoadMoreButton({
	containerRef,
	label,
	onClick,
}: {
	containerRef: Ref<HTMLDivElement>;
	label: string;
	onClick: () => void;
}) {
	return (
		<div ref={containerRef} className="px-2 py-1">
			<button
				type="button"
				onClick={onClick}
				className="flex w-full items-center justify-center gap-1 border border-dark-800 px-2 py-1 text-xs text-dark-500 transition-colors hover:border-dark-700 hover:text-dark-100"
			>
				<ChevronDown size={12} />
				{label}
			</button>
		</div>
	);
}
