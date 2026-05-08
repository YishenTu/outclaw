import { ChevronDown, ChevronRight, Search } from "lucide-react";
import {
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	type Ref,
	useEffect,
	useRef,
	useState,
} from "react";
import type { SessionCursor } from "../../../../common/protocol.ts";
import { useWs } from "../../contexts/websocket-context.tsx";
import type { AgentEntry, AgentReorderPosition } from "../../stores/agents.ts";
import type { SessionEntry, SessionRef } from "../../stores/sessions.ts";
import { useWorkspaceViewStore } from "../../stores/workspace-view.ts";
import { groupSessionsByAge, type SessionGroupKey } from "./group-sessions.ts";
import { SessionItem } from "./session-item.tsx";

interface AgentItemProps {
	agent: AgentEntry;
	isActive: boolean;
	isExpanded: boolean;
	isDragging: boolean;
	dropIndicator: AgentReorderPosition | null;
	onAttachRow: (element: HTMLDivElement | null) => void;
	activeSession: SessionRef | null;
	nextCursor?: SessionCursor;
	searchState?: {
		query: string;
		sessions: SessionEntry[];
		nextCursor?: SessionCursor;
	};
	sessions: SessionEntry[];
	onClearSearch: () => void;
	onLoadMore: () => void;
	onLoadMoreSearch: (query: string) => void;
	onRowPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
	onSearch: (query: string) => void;
	onToggle: () => void;
}

function formatAgentDisplayName(name: string): string {
	return name.slice(0, 1).toUpperCase() + name.slice(1);
}

export function AgentItem({
	agent,
	isActive,
	isExpanded,
	isDragging,
	dropIndicator,
	onAttachRow,
	activeSession,
	nextCursor,
	searchState,
	sessions,
	onClearSearch,
	onLoadMore,
	onLoadMoreSearch,
	onRowPointerDown,
	onSearch,
	onToggle,
}: AgentItemProps) {
	const { sendCommand, switchSession } = useWs();
	const openWorkspace = useWorkspaceViewStore((state) => state.openWorkspace);
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

	function renderSession(session: SessionEntry) {
		return (
			<SessionItem
				key={`${session.providerId}:${session.sdkSessionId}`}
				session={session}
				isActive={
					activeSession?.providerId === session.providerId &&
					activeSession.sdkSessionId === session.sdkSessionId
				}
				onSelect={() => {
					if (switchSession(agent.name, session)) {
						openWorkspace();
					}
				}}
				onRename={(title) =>
					sendCommand(`/session rename ${session.sdkSessionId} ${title}`)
				}
				onDelete={() => sendCommand(`/session delete ${session.sdkSessionId}`)}
			/>
		);
	}

	return (
		<div ref={onAttachRow} className="relative space-y-0.5">
			{dropIndicator === "before" && (
				<div className="pointer-events-none absolute inset-x-2 top-0 z-10 border-t border-dark-300/90" />
			)}
			{isActive && (
				<span
					aria-hidden="true"
					className="pointer-events-none absolute inset-y-1 left-0 z-20 w-px rounded-full bg-brand"
				/>
			)}
			<div
				role="treeitem"
				aria-expanded={isExpanded}
				tabIndex={-1}
				onPointerDown={onRowPointerDown}
				className={`flex items-center gap-2 rounded px-2 py-1 text-sm transition-colors ${
					isActive ? "text-dark-50" : "text-dark-500 hover:text-dark-300"
				} ${isDragging ? "opacity-60" : ""}`}
				style={{ paddingLeft: "12px" }}
			>
				<button
					type="button"
					onClick={onToggle}
					className={`flex min-w-0 flex-1 items-center gap-2 text-left ${
						isDragging ? "cursor-grabbing" : "cursor-grab"
					}`}
				>
					{isExpanded ? (
						<ChevronDown size={14} className="shrink-0" />
					) : (
						<ChevronRight size={14} className="shrink-0" />
					)}
					<div className="min-w-0 flex-1 truncate text-[15px]">
						{formatAgentDisplayName(agent.name)}
					</div>
				</button>
				<div className="flex w-14 shrink-0 items-center justify-end gap-2">
					<button
						type="button"
						data-agent-row-ignore-drag="true"
						aria-label={
							searchOpen
								? `Close session search for ${agent.name}`
								: `Search sessions for ${agent.name}`
						}
						onClick={toggleSearch}
						className="flex items-center justify-center text-dark-500 transition-colors hover:text-dark-100"
					>
						<Search size={14} />
					</button>
					<button
						type="button"
						data-agent-row-ignore-drag="true"
						aria-label={`Start new session for ${agent.name}`}
						onClick={() => {
							if (!isActive && !sendCommand(`/agent ${agent.name}`)) {
								return;
							}
							if (sendCommand("/new")) {
								openWorkspace();
							}
						}}
						className="font-mono-ui flex items-center justify-end text-[18px] leading-none text-dark-500 transition-colors hover:text-dark-100"
					>
						+
					</button>
				</div>
			</div>

			{isExpanded && (
				<div className="space-y-0.5">
					{searchOpen && (
						<div
							className="flex items-center gap-1 px-2 py-1"
							data-agent-row-ignore-drag="true"
						>
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
							No cached sessions for this agent yet.
						</div>
					) : (
						<>
							{renderGroupedSessions(sessions, renderSession)}
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

			{dropIndicator === "after" && (
				<div className="pointer-events-none absolute inset-x-2 bottom-0 z-10 border-t border-dark-300/90" />
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
				data-agent-row-ignore-drag="true"
				onClick={onClick}
				className="flex w-full items-center justify-center gap-1 border border-dark-800 px-2 py-1 text-xs text-dark-500 transition-colors hover:border-dark-700 hover:text-dark-100"
			>
				<ChevronDown size={12} />
				{label}
			</button>
		</div>
	);
}

const GROUP_LABELS: Record<SessionGroupKey, string> = {
	today: "Today",
	week: "This week",
	month: "This month",
	older: "Older",
};

const GROUP_ORDER: SessionGroupKey[] = ["today", "week", "month", "older"];

function renderGroupedSessions(
	sessions: SessionEntry[],
	renderSession: (session: SessionEntry) => ReactNode,
) {
	const grouped = groupSessionsByAge(sessions);
	return GROUP_ORDER.flatMap((group) => {
		const entries = grouped[group];
		if (entries.length === 0) {
			return [];
		}
		return [
			<div
				key={`${group}-header`}
				className="sticky top-0 z-10 bg-dark-950 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-dark-500"
			>
				{GROUP_LABELS[group]}
			</div>,
			...entries.map(renderSession),
		];
	});
}
