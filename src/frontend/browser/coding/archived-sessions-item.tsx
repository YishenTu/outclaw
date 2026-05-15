import { Archive, ChevronDown, Search, X } from "lucide-react";
import { type Ref, useEffect, useMemo, useRef, useState } from "react";
import type {
	BrowserCodingRepositorySummary,
	BrowserCodingSessionSummary,
	SessionCursor,
} from "../../../common/protocol.ts";
import { SessionItem } from "../components/agent-sidebar/session-item.tsx";

interface ArchivedSessionSearchState {
	query: string;
	sessions: BrowserCodingSessionSummary[];
	nextCursor?: SessionCursor;
}

interface ArchivedSessionsItemProps {
	isOpen: boolean;
	repositories: BrowserCodingRepositorySummary[];
	sessions: BrowserCodingSessionSummary[];
	nextCursor?: SessionCursor;
	searchState?: ArchivedSessionSearchState;
	triggerClassName?: string;
	triggerLabel?: string;
	onOpen: () => void;
	onClose: () => void;
	onSelectSession: (session: BrowserCodingSessionSummary) => void;
	onRenameSession: (
		session: BrowserCodingSessionSummary,
		title: string,
	) => void;
	onRestoreSession: (session: BrowserCodingSessionSummary) => void;
	onLoadMore: () => void;
	onSearch: (query: string) => void;
	onLoadMoreSearch: (query: string) => void;
	onClearSearch: () => void;
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
}: {
	cursor: SessionCursor | undefined;
	searchQuery?: string;
}): string | undefined {
	if (!cursor) {
		return undefined;
	}
	const query = searchQuery?.trim();
	const scope = query ? `search:${query}` : "archive";
	return `${scope}:${cursor.lastActive}:${cursor.sdkSessionId}`;
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
	sessions,
	nextCursor,
	searchState,
	triggerClassName = "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm text-dark-500 transition-colors hover:text-dark-300",
	triggerLabel = "Archive",
	onOpen,
	onClose,
	onSelectSession,
	onRenameSession,
	onRestoreSession,
	onLoadMore,
	onSearch,
	onLoadMoreSearch,
	onClearSearch,
}: ArchivedSessionsItemProps) {
	const [draftSearch, setDraftSearch] = useState(searchState?.query ?? "");
	const searchInputRef = useRef<HTMLInputElement | null>(null);
	const loadMoreRef = useRef<HTMLDivElement | null>(null);
	const observedLoadMoreRequestKeyRef = useRef<string | undefined>(undefined);
	const lastSubmittedSearchRef = useRef<string | undefined>(searchState?.query);
	const effectiveSearchQuery = draftSearch.trim();
	const searchActive = isOpen && effectiveSearchQuery !== "";
	const visibleSearchResults =
		searchActive && searchState?.query === effectiveSearchQuery
			? searchState.sessions
			: [];
	const visibleSessions = searchActive ? visibleSearchResults : sessions;
	const visibleNextCursor = searchActive ? searchState?.nextCursor : nextCursor;
	const visibleLoadMoreRequestKey = createArchivedLoadMoreRequestKey({
		cursor: visibleNextCursor,
		searchQuery: searchActive ? effectiveSearchQuery : undefined,
	});
	const groupedSessions = useMemo(
		() => groupArchivedSessionsByProject(visibleSessions, repositories),
		[repositories, visibleSessions],
	);

	useEffect(() => {
		const query = searchState?.query;
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
	}, [isOpen, searchState?.query]);

	useEffect(() => {
		if (!isOpen) {
			observedLoadMoreRequestKeyRef.current = undefined;
			return;
		}
		const frameId = window.requestAnimationFrame(() => {
			searchInputRef.current?.focus();
		});
		return () => window.cancelAnimationFrame(frameId);
	}, [isOpen]);

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

	useEffect(() => {
		if (!isOpen) {
			return;
		}
		const submission = resolveArchivedSearchSubmission({
			currentSearchQuery: searchState?.query,
			draftQuery: draftSearch,
			lastSubmittedQuery: lastSubmittedSearchRef.current,
		});
		if (submission.type === "none") {
			return;
		}
		const timer = setTimeout(() => {
			if (submission.type === "clear") {
				lastSubmittedSearchRef.current = undefined;
				onClearSearch();
				return;
			}
			lastSubmittedSearchRef.current = submission.query;
			onSearch(submission.query);
		}, 150);
		return () => clearTimeout(timer);
	}, [draftSearch, isOpen, onClearSearch, onSearch, searchState?.query]);

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
				onLoadMoreSearch(effectiveSearchQuery);
			} else {
				onLoadMore();
			}
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, [
		effectiveSearchQuery,
		isOpen,
		onLoadMore,
		onLoadMoreSearch,
		searchActive,
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
				onSelect={() => {
					onSelectSession(session);
					onClose();
				}}
				onRename={(nextTitle) => onRenameSession(session, nextTitle)}
				onDelete={() => onRestoreSession(session)}
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
			<button
				type="button"
				aria-label="Open archived sessions"
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
						aria-label="Archived sessions"
						aria-modal="true"
						className="flex max-h-[min(760px,calc(100vh-48px))] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-dark-800 bg-dark-950 shadow-2xl shadow-black/50"
					>
						<div className="flex items-center justify-between gap-3 bg-dark-900/40 px-5 py-4">
							<div className="flex items-center gap-2 text-dark-50">
								<Archive size={16} className="shrink-0 text-dark-300" />
								<div className="font-display text-[15px] font-semibold tracking-[0.01em]">
									Archived sessions
								</div>
							</div>
							<button
								type="button"
								onClick={onClose}
								aria-label="Close archived sessions"
								className="text-dark-500 transition-colors hover:text-dark-100"
							>
								<X size={16} />
							</button>
						</div>

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
									placeholder="Search archived sessions"
									spellCheck={false}
									className="min-w-0 flex-1 bg-transparent text-sm text-dark-50 outline-none placeholder:text-dark-600"
								/>
							</label>
						</div>

						<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
							{groupedSessions.length === 0 ? (
								<div className="px-3 py-2 text-sm text-dark-500">
									{searchActive
										? "No matching archived sessions."
										: "No archived sessions."}
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
												searchActive
													? "Load more archived results"
													: "Load more archived sessions"
											}
											onClick={() => {
												if (searchActive) {
													onLoadMoreSearch(effectiveSearchQuery);
												} else {
													onLoadMore();
												}
											}}
										/>
									)}
								</div>
							)}
						</div>
					</div>
				</div>
			)}
		</>
	);
}

function groupArchivedSessionsByProject(
	sessions: BrowserCodingSessionSummary[],
	repositories: BrowserCodingRepositorySummary[],
): ArchivedSessionProjectGroup[] {
	const repositoriesById = new Map(
		repositories.map((repository) => [repository.id, repository]),
	);
	const groups: ArchivedSessionProjectGroup[] = [];
	const groupsByKey = new Map<string, ArchivedSessionProjectGroup>();
	for (const session of sessions) {
		const project = describeArchivedSessionProject(session, repositoriesById);
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

function describeArchivedSessionProject(
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
