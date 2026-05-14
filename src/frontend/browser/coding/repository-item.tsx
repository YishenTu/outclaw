import {
	Archive,
	ChevronDown,
	ChevronRight,
	MoreHorizontal,
	Search,
} from "lucide-react";
import { type Ref, useEffect, useRef, useState } from "react";
import type {
	BrowserCodingSessionSummary,
	SessionCursor,
} from "../../../common/protocol.ts";
import { SessionItem } from "../components/agent-sidebar/session-item.tsx";

interface RepositorySearchState {
	query: string;
	sessions: BrowserCodingSessionSummary[];
	nextCursor?: SessionCursor;
}

interface RepositoryItemProps {
	repository: { id: string; displayName: string };
	isExpanded: boolean;
	focusedSession?: { providerId: string; sdkSessionId: string };
	sessions: BrowserCodingSessionSummary[];
	nextCursor?: SessionCursor;
	searchState?: RepositorySearchState;
	onToggle: () => void;
	onSelectRepository: () => void;
	onNewSession: () => void;
	onArchiveRepository: () => void;
	onSelectSession: (session: BrowserCodingSessionSummary) => void;
	onRenameSession: (
		session: BrowserCodingSessionSummary,
		title: string,
	) => void;
	onArchiveSession: (session: BrowserCodingSessionSummary) => void;
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
	onArchiveRepository,
	onSelectSession,
	onRenameSession,
	onArchiveSession,
	onLoadMore,
	onSearch,
	onLoadMoreSearch,
	onClearSearch,
}: RepositoryItemProps) {
	const [searchOpen, setSearchOpen] = useState(
		() => (searchState?.query.trim() ?? "") !== "",
	);
	const [draftSearch, setDraftSearch] = useState(searchState?.query ?? "");
	const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
	const loadMoreRef = useRef<HTMLDivElement | null>(null);
	const actionsMenuRef = useRef<HTMLDivElement | null>(null);
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

	function closeActionsMenu() {
		setActionsMenuOpen(false);
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
		if (!actionsMenuOpen) {
			return;
		}

		function closeMenu() {
			setActionsMenuOpen(false);
		}

		function handlePointerDown(event: PointerEvent) {
			if (actionsMenuRef.current?.contains(event.target as Node)) {
				return;
			}
			closeMenu();
		}

		function handleKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				event.preventDefault();
				closeMenu();
			}
		}

		document.addEventListener("pointerdown", handlePointerDown);
		window.addEventListener("blur", closeMenu);
		window.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("pointerdown", handlePointerDown);
			window.removeEventListener("blur", closeMenu);
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, [actionsMenuOpen]);

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

	function renderOpenSession(session: BrowserCodingSessionSummary) {
		const title = session.title || session.sdkSessionId;
		return (
			<SessionItem
				key={`${session.providerId}:${session.sdkSessionId}`}
				title={title}
				lastActive={session.lastActive}
				isActive={
					focusedSession?.providerId === session.providerId &&
					focusedSession.sdkSessionId === session.sdkSessionId
				}
				onSelect={() => onSelectSession(session)}
				onRename={(nextTitle) => onRenameSession(session, nextTitle)}
				onDelete={() => onArchiveSession(session)}
				actionAriaLabel={`Archive session ${title}`}
				actionIcon="archive"
				actionLabel="Archive"
				actionRequiresConfirmation={false}
				actionTone="neutral"
			/>
		);
	}

	return (
		<div className="relative space-y-0.5">
			<div
				role="treeitem"
				aria-expanded={isExpanded}
				tabIndex={-1}
				className="group relative flex items-center gap-2 rounded px-2 py-1 text-sm text-dark-500 transition-colors hover:text-dark-300"
				style={{ paddingLeft: "12px" }}
			>
				<button
					type="button"
					onClick={() => {
						onSelectRepository();
						onToggle();
					}}
					className="flex min-w-0 flex-1 items-center gap-2 pr-16 text-left"
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
				<div
					className={`absolute inset-y-0 right-2 z-10 flex items-center gap-1 rounded bg-dark-950/95 pl-1 transition-opacity ${
						actionsMenuOpen
							? "pointer-events-auto opacity-100"
							: "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
					}`}
				>
					<div ref={actionsMenuRef} className="relative flex items-center">
						<button
							type="button"
							aria-label={`Open repository actions for ${repository.displayName}`}
							aria-haspopup="menu"
							aria-expanded={actionsMenuOpen}
							onClick={() => setActionsMenuOpen((current) => !current)}
							className="flex h-5 w-5 items-center justify-center text-dark-500 transition-colors hover:text-dark-100"
						>
							<MoreHorizontal size={13} />
						</button>
						{actionsMenuOpen && (
							<div
								role="menu"
								aria-label={`Repository actions for ${repository.displayName}`}
								className="absolute right-0 top-full z-30 mt-1 min-w-[11rem] overflow-hidden rounded-[16px] border border-dark-800 bg-dark-900 shadow-lg"
							>
								<button
									type="button"
									role="menuitem"
									aria-label={
										searchOpen
											? `Close session search for ${repository.displayName}`
											: `Search sessions for ${repository.displayName}`
									}
									onClick={() => {
										closeActionsMenu();
										toggleSearch();
									}}
									className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-dark-300 transition-colors hover:bg-dark-800/70 hover:text-dark-100"
								>
									<Search size={14} className="shrink-0" />
									<span>
										{searchOpen ? "Close session search" : "Search sessions"}
									</span>
								</button>
								<button
									type="button"
									role="menuitem"
									aria-label={`Archive repository ${repository.displayName}`}
									onClick={() => {
										closeActionsMenu();
										onArchiveRepository();
									}}
									className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-dark-300 transition-colors hover:bg-dark-800/70 hover:text-dark-100"
								>
									<Archive size={14} className="shrink-0" />
									<span>Archive repository</span>
								</button>
							</div>
						)}
					</div>
					<button
						type="button"
						aria-label={`Start new session in ${repository.displayName}`}
						onClick={onNewSession}
						className="font-mono-ui flex h-5 w-5 items-center justify-center text-[17px] leading-none text-dark-500 transition-colors hover:text-dark-100"
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
							<div className="px-3 py-1.5 text-sm text-dark-500">
								No matching sessions.
							</div>
						) : (
							<>
								{visibleSearchResults.map(renderOpenSession)}
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
						<div className="px-3 py-1.5 text-sm text-dark-500">
							No sessions yet for this project.
						</div>
					) : (
						<>
							{sessions.map(renderOpenSession)}
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
