import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { type Ref, useEffect, useRef, useState } from "react";
import type {
	BrowserCodingSessionSummary,
	SessionCursor,
} from "../../../common/protocol.ts";
import { SessionItem } from "../components/agent-sidebar/session-item.tsx";

interface RepositoryItemProps {
	repository: { id: string; displayName: string };
	isExpanded: boolean;
	focusedSession?: { providerId: string; sdkSessionId: string };
	sessions: BrowserCodingSessionSummary[];
	nextCursor?: SessionCursor;
	searchState?: {
		query: string;
		sessions: BrowserCodingSessionSummary[];
		nextCursor?: SessionCursor;
	};
	onToggle: () => void;
	onSelectRepository: () => void;
	onNewSession: () => void;
	onSelectSession: (session: BrowserCodingSessionSummary) => void;
	onRenameSession: (
		session: BrowserCodingSessionSummary,
		title: string,
	) => void;
	onDeleteSession: (session: BrowserCodingSessionSummary) => void;
	onLoadMore: () => void;
	onSearch: (query: string) => void;
	onLoadMoreSearch: (query: string) => void;
	onClearSearch: () => void;
}

export function RepositoryItem({
	repository,
	isExpanded,
	focusedSession,
	sessions,
	nextCursor,
	searchState,
	onToggle,
	onSelectRepository,
	onNewSession,
	onSelectSession,
	onRenameSession,
	onDeleteSession,
	onLoadMore,
	onSearch,
	onLoadMoreSearch,
	onClearSearch,
}: RepositoryItemProps) {
	const [searchOpen, setSearchOpen] = useState(
		() => (searchState?.query.trim() ?? "") !== "",
	);
	const [draftSearch, setDraftSearch] = useState(searchState?.query ?? "");
	const loadMoreRef = useRef<HTMLDivElement | null>(null);
	const effectiveSearchQuery = draftSearch.trim();
	const searchActive = searchOpen && effectiveSearchQuery !== "";
	const visibleSearchResults =
		searchActive && searchState?.query === effectiveSearchQuery
			? searchState.sessions
			: [];

	function closeSearch() {
		setDraftSearch("");
		setSearchOpen(false);
		onClearSearch();
	}

	function toggleSearch() {
		if (searchOpen) {
			closeSearch();
			return;
		}
		setSearchOpen(true);
	}

	useEffect(() => {
		if (!searchOpen && searchState?.query) {
			setDraftSearch(searchState.query);
			setSearchOpen(true);
		}
	}, [searchOpen, searchState?.query]);

	useEffect(() => {
		if (!searchOpen) {
			return;
		}
		const query = draftSearch.trim();
		const timer = setTimeout(() => {
			if (!query) {
				onClearSearch();
				return;
			}
			onSearch(query);
		}, 150);
		return () => clearTimeout(timer);
	}, [draftSearch, onClearSearch, onSearch, searchOpen]);

	useEffect(() => {
		const cursor = searchActive ? searchState?.nextCursor : nextCursor;
		if (!isExpanded || !cursor || typeof IntersectionObserver === "undefined") {
			return;
		}
		const element = loadMoreRef.current;
		if (!element) {
			return;
		}
		const observer = new IntersectionObserver((entries) => {
			if (entries.some((entry) => entry.isIntersecting)) {
				if (searchActive) {
					onLoadMoreSearch(effectiveSearchQuery);
				} else {
					onLoadMore();
				}
			}
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, [
		effectiveSearchQuery,
		isExpanded,
		nextCursor,
		onLoadMore,
		onLoadMoreSearch,
		searchActive,
		searchState?.nextCursor,
	]);

	function renderSession(session: BrowserCodingSessionSummary) {
		return (
			<SessionItem
				key={`${session.providerId}:${session.sdkSessionId}`}
				title={session.title || session.sdkSessionId}
				lastActive={session.lastActive}
				isActive={
					focusedSession?.providerId === session.providerId &&
					focusedSession.sdkSessionId === session.sdkSessionId
				}
				onSelect={() => onSelectSession(session)}
				onRename={(title) => onRenameSession(session, title)}
				onDelete={() => onDeleteSession(session)}
			/>
		);
	}

	return (
		<div className="relative space-y-0.5">
			<div
				role="treeitem"
				aria-expanded={isExpanded}
				tabIndex={-1}
				className="flex items-center gap-2 rounded px-2 py-1 text-sm text-dark-500 transition-colors hover:text-dark-300"
				style={{ paddingLeft: "12px" }}
			>
				<button
					type="button"
					onClick={() => {
						onSelectRepository();
						onToggle();
					}}
					className="flex min-w-0 flex-1 items-center gap-2 text-left"
				>
					{isExpanded ? (
						<ChevronDown size={14} className="shrink-0" />
					) : (
						<ChevronRight size={14} className="shrink-0" />
					)}
					<div className="min-w-0 flex-1 truncate text-[15px]">
						{repository.displayName}
					</div>
				</button>
				<div className="flex w-14 shrink-0 items-center justify-end gap-2">
					<button
						type="button"
						aria-label={
							searchOpen
								? `Close session search for ${repository.displayName}`
								: `Search sessions for ${repository.displayName}`
						}
						onClick={toggleSearch}
						className="flex items-center justify-center text-dark-500 transition-colors hover:text-dark-100"
					>
						<Search size={14} />
					</button>
					<button
						type="button"
						aria-label={`Start new session in ${repository.displayName}`}
						onClick={onNewSession}
						className="font-mono-ui flex items-center justify-end text-[18px] leading-none text-dark-500 transition-colors hover:text-dark-100"
					>
						+
					</button>
				</div>
			</div>

			{isExpanded && (
				<div className="space-y-0.5">
					{searchOpen && (
						<div className="flex items-center gap-1 px-2 py-1">
							<input
								value={draftSearch}
								onChange={(event) => setDraftSearch(event.target.value)}
								placeholder="Search sessions"
								className="min-w-0 flex-1 rounded border border-dark-800 bg-dark-950 px-2 py-1 text-sm text-dark-100 outline-none transition-colors placeholder:text-dark-600 focus:border-dark-500"
							/>
						</div>
					)}
					{searchActive ? (
						visibleSearchResults.length === 0 ? (
							<div className="border border-dashed border-dark-800 px-3 py-1.5 text-sm text-dark-500">
								No matching sessions.
							</div>
						) : (
							<>
								{visibleSearchResults.map(renderSession)}
								{searchState?.nextCursor && (
									<LoadMoreButton
										containerRef={loadMoreRef}
										label="Load more results"
										onClick={() => onLoadMoreSearch(effectiveSearchQuery)}
									/>
								)}
							</>
						)
					) : sessions.length === 0 ? (
						<div className="border border-dashed border-dark-800 px-3 py-1.5 text-sm text-dark-500">
							No sessions yet for this project.
						</div>
					) : (
						<>
							{sessions.map(renderSession)}
							{nextCursor && (
								<LoadMoreButton
									containerRef={loadMoreRef}
									label="Load more sessions"
									onClick={onLoadMore}
								/>
							)}
						</>
					)}
				</div>
			)}
		</div>
	);
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
