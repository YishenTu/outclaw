import { create } from "zustand";
import type { SessionCursor } from "../../../common/protocol.ts";
import {
	providerSessionRefKey,
	providerSessionRefsEqual,
} from "../../../common/provider-session-ref.ts";

export interface SessionRef {
	agentId: string;
	providerId: string;
	sdkSessionId: string;
}

export interface SessionEntry extends SessionRef {
	title: string;
	model: string;
	lastActive: number;
}

export interface SessionsState {
	sessionsByAgent: Record<string, SessionEntry[]>;
	activeSessionByAgent: Record<string, SessionRef | null>;
	nextCursorByAgent: Record<string, SessionCursor | undefined>;
	searchByAgent: Record<
		string,
		{ query: string; sessions: SessionEntry[]; nextCursor?: SessionCursor }
	>;

	setSessions: (
		agentId: string,
		sessions: SessionEntry[],
		nextCursor?: SessionCursor,
	) => void;
	appendSessions: (
		agentId: string,
		sessions: SessionEntry[],
		nextCursor?: SessionCursor,
	) => void;
	refreshSessions: (
		agentId: string,
		sessions: SessionEntry[],
		nextCursor?: SessionCursor,
	) => void;
	setActiveSession: (agentId: string, session: SessionRef | null) => void;
	setSearchResults: (
		agentId: string,
		query: string,
		sessions: SessionEntry[],
		nextCursor?: SessionCursor,
	) => void;
	appendSearchResults: (
		agentId: string,
		query: string,
		sessions: SessionEntry[],
		nextCursor?: SessionCursor,
	) => void;
	clearSearch: (agentId: string) => void;
	renameSession: (session: SessionRef, title: string) => void;
	deleteSession: (session: SessionRef) => void;
	deleteSessionBySdkId: (sdkSessionId: string) => void;
}

function matchesSession(left: SessionRef, right: SessionRef): boolean {
	return (
		left.agentId === right.agentId && providerSessionRefsEqual(left, right)
	);
}

function sessionRefsEqual(
	left: SessionRef | null | undefined,
	right: SessionRef | null | undefined,
): boolean {
	if (!left || !right) {
		return left === right;
	}
	return matchesSession(left, right);
}

function sessionEntriesEqual(
	left: SessionEntry[] | undefined,
	right: SessionEntry[],
): boolean {
	return (
		left !== undefined &&
		left.length === right.length &&
		left.every((session, index) => {
			const other = right[index];
			return (
				other !== undefined &&
				matchesSession(session, other) &&
				session.title === other.title &&
				session.model === other.model &&
				session.lastActive === other.lastActive
			);
		})
	);
}

function cursorsEqual(
	left: SessionCursor | undefined,
	right: SessionCursor | undefined,
): boolean {
	if (!left || !right) {
		return left === right;
	}
	return (
		left.lastActive === right.lastActive &&
		left.providerId === right.providerId &&
		left.sdkSessionId === right.sdkSessionId
	);
}

export const useSessionsStore = create<SessionsState>((set) => ({
	sessionsByAgent: {},
	activeSessionByAgent: {},
	nextCursorByAgent: {},
	searchByAgent: {},
	setSessions: (agentId, sessions, nextCursor) =>
		set((state) => {
			if (
				sessionEntriesEqual(state.sessionsByAgent[agentId], sessions) &&
				cursorsEqual(state.nextCursorByAgent[agentId], nextCursor)
			) {
				return state;
			}
			return {
				nextCursorByAgent: {
					...state.nextCursorByAgent,
					[agentId]: nextCursor,
				},
				sessionsByAgent: {
					...state.sessionsByAgent,
					[agentId]: sessions,
				},
			};
		}),
	appendSessions: (agentId, sessions, nextCursor) =>
		set((state) => ({
			nextCursorByAgent: {
				...state.nextCursorByAgent,
				[agentId]: nextCursor,
			},
			sessionsByAgent: {
				...state.sessionsByAgent,
				[agentId]: mergeSessions(
					state.sessionsByAgent[agentId] ?? [],
					sessions,
				),
			},
		})),
	refreshSessions: (agentId, sessions, nextCursor) =>
		set((state) => {
			const current = state.sessionsByAgent[agentId] ?? [];
			const nextSessions = mergeRefreshedLeadingPage(
				current,
				sessions,
				nextCursor,
			);
			if (
				sessionEntriesEqual(state.sessionsByAgent[agentId], nextSessions) &&
				cursorsEqual(state.nextCursorByAgent[agentId], nextCursor)
			) {
				return state;
			}
			return {
				nextCursorByAgent: {
					...state.nextCursorByAgent,
					[agentId]: nextCursor,
				},
				sessionsByAgent: {
					...state.sessionsByAgent,
					[agentId]: nextSessions,
				},
			};
		}),
	setActiveSession: (agentId, session) =>
		set((state) => {
			if (sessionRefsEqual(state.activeSessionByAgent[agentId], session)) {
				return state;
			}
			return {
				activeSessionByAgent: {
					...state.activeSessionByAgent,
					[agentId]: session,
				},
			};
		}),
	setSearchResults: (agentId, query, sessions, nextCursor) =>
		set((state) => ({
			searchByAgent: {
				...state.searchByAgent,
				[agentId]: {
					query,
					sessions,
					nextCursor,
				},
			},
		})),
	appendSearchResults: (agentId, query, sessions, nextCursor) =>
		set((state) => {
			const current = state.searchByAgent[agentId];
			if (!current || current.query !== query) {
				return state;
			}
			return {
				searchByAgent: {
					...state.searchByAgent,
					[agentId]: {
						query,
						sessions: mergeSessions(current.sessions, sessions),
						nextCursor,
					},
				},
			};
		}),
	clearSearch: (agentId) =>
		set((state) => {
			const { [agentId]: _removed, ...searchByAgent } = state.searchByAgent;
			return { searchByAgent };
		}),
	renameSession: (session, title) =>
		set((state) => {
			const activeSearch = state.searchByAgent[session.agentId];
			return {
				searchByAgent: activeSearch
					? {
							...state.searchByAgent,
							[session.agentId]: {
								...activeSearch,
								sessions: activeSearch.sessions.map((entry) =>
									matchesSession(entry, session) ? { ...entry, title } : entry,
								),
							},
						}
					: state.searchByAgent,
				sessionsByAgent: {
					...state.sessionsByAgent,
					[session.agentId]:
						state.sessionsByAgent[session.agentId]?.map((entry) =>
							matchesSession(entry, session) ? { ...entry, title } : entry,
						) ?? [],
				},
			};
		}),
	deleteSession: (session) =>
		set((state) => {
			const nextSessions =
				state.sessionsByAgent[session.agentId]?.filter(
					(entry) => !matchesSession(entry, session),
				) ?? [];
			const nextSearch = state.searchByAgent[session.agentId];
			const activeSession = state.activeSessionByAgent[session.agentId];
			return {
				searchByAgent: nextSearch
					? {
							...state.searchByAgent,
							[session.agentId]: {
								...nextSearch,
								sessions: nextSearch.sessions.filter(
									(entry) => !matchesSession(entry, session),
								),
							},
						}
					: state.searchByAgent,
				sessionsByAgent: {
					...state.sessionsByAgent,
					[session.agentId]: nextSessions,
				},
				activeSessionByAgent: {
					...state.activeSessionByAgent,
					[session.agentId]:
						activeSession && matchesSession(activeSession, session)
							? null
							: (activeSession ?? null),
				},
			};
		}),
	deleteSessionBySdkId: (sdkSessionId) =>
		set((state) => {
			const nextSessionsByAgent: Record<string, SessionEntry[]> = {};
			for (const [agentId, sessions] of Object.entries(state.sessionsByAgent)) {
				nextSessionsByAgent[agentId] = sessions.filter(
					(entry) => entry.sdkSessionId !== sdkSessionId,
				);
			}
			const nextSearchByAgent: SessionsState["searchByAgent"] = {};
			for (const [agentId, search] of Object.entries(state.searchByAgent)) {
				nextSearchByAgent[agentId] = {
					...search,
					sessions: search.sessions.filter(
						(entry) => entry.sdkSessionId !== sdkSessionId,
					),
				};
			}
			const nextActiveByAgent: Record<string, SessionRef | null> = {};
			for (const [agentId, active] of Object.entries(
				state.activeSessionByAgent,
			)) {
				nextActiveByAgent[agentId] =
					active && active.sdkSessionId === sdkSessionId ? null : active;
			}
			return {
				searchByAgent: nextSearchByAgent,
				sessionsByAgent: nextSessionsByAgent,
				activeSessionByAgent: nextActiveByAgent,
			};
		}),
}));

function mergeSessions(
	current: SessionEntry[],
	incoming: SessionEntry[],
): SessionEntry[] {
	const merged = [...current];
	const seen = new Set(current.map(sessionKey));
	for (const session of incoming) {
		const key = sessionKey(session);
		if (seen.has(key)) {
			continue;
		}
		merged.push(session);
		seen.add(key);
	}
	return merged;
}

function mergeRefreshedLeadingPage(
	current: SessionEntry[],
	refreshed: SessionEntry[],
	nextCursor: SessionCursor | undefined,
): SessionEntry[] {
	if (!nextCursor) {
		return refreshed;
	}

	const refreshedKeys = new Set(refreshed.map(sessionKey));
	const preservedTail = current.filter(
		(session) =>
			isAfterCursor(session, nextCursor) &&
			!refreshedKeys.has(sessionKey(session)),
	);
	return [...refreshed, ...preservedTail];
}

function isAfterCursor(
	session: Pick<SessionEntry, "lastActive" | "providerId" | "sdkSessionId">,
	cursor: SessionCursor,
): boolean {
	if (cursor.providerId) {
		return (
			session.lastActive < cursor.lastActive ||
			(session.lastActive === cursor.lastActive &&
				(session.providerId > cursor.providerId ||
					(session.providerId === cursor.providerId &&
						session.sdkSessionId > cursor.sdkSessionId)))
		);
	}
	return (
		session.lastActive < cursor.lastActive ||
		(session.lastActive === cursor.lastActive &&
			session.sdkSessionId > cursor.sdkSessionId)
	);
}

function sessionKey(session: SessionRef): string {
	return `${session.agentId}\u0000${providerSessionRefKey(session)}`;
}
