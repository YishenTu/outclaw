import { create } from "zustand";

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

	setSessions: (agentId: string, sessions: SessionEntry[]) => void;
	setActiveSession: (agentId: string, session: SessionRef | null) => void;
	renameSession: (session: SessionRef, title: string) => void;
	deleteSession: (session: SessionRef) => void;
}

function matchesSession(left: SessionRef, right: SessionRef): boolean {
	return (
		left.agentId === right.agentId &&
		left.providerId === right.providerId &&
		left.sdkSessionId === right.sdkSessionId
	);
}

export const useSessionsStore = create<SessionsState>((set) => ({
	sessionsByAgent: {},
	activeSessionByAgent: {},
	setSessions: (agentId, sessions) =>
		set((state) => ({
			sessionsByAgent: {
				...state.sessionsByAgent,
				[agentId]: sessions,
			},
		})),
	setActiveSession: (agentId, session) =>
		set((state) => ({
			activeSessionByAgent: {
				...state.activeSessionByAgent,
				[agentId]: session,
			},
		})),
	renameSession: (session, title) =>
		set((state) => ({
			sessionsByAgent: {
				...state.sessionsByAgent,
				[session.agentId]:
					state.sessionsByAgent[session.agentId]?.map((entry) =>
						matchesSession(entry, session) ? { ...entry, title } : entry,
					) ?? [],
			},
		})),
	deleteSession: (session) =>
		set((state) => {
			const nextSessions =
				state.sessionsByAgent[session.agentId]?.filter(
					(entry) => !matchesSession(entry, session),
				) ?? [];
			const activeSession = state.activeSessionByAgent[session.agentId];
			return {
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
}));
