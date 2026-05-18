import {
	type BrowserAgentsResponse,
	type BrowserSessionPageResponse,
	extractError,
} from "../../../common/protocol.ts";
import type { SidebarRefreshGate } from "./sidebar-refresh-gate.ts";

const DEFAULT_AGENT_SESSION_REFRESH_LIMIT = 10;
const MAX_AGENT_SESSION_REFRESH_LIMIT = 100;

interface SidebarRefreshCoordinatorParams<SocketLike> {
	applyAgentSessionPage: (
		agentId: string,
		page: BrowserSessionPageResponse,
	) => void;
	applySidebarSummary: (summary: BrowserAgentsResponse) => void;
	fetchAgentSessionPage: (
		agentId: string,
		params: { limit: number },
	) => Promise<BrowserSessionPageResponse>;
	fetchSidebarSummary: () => Promise<BrowserAgentsResponse>;
	gate: SidebarRefreshGate;
	getLoadedAgentSessionCount: (agentId: string) => number;
	getSocket: () => SocketLike | null;
	isSocketOpen: (socket: SocketLike | null) => socket is SocketLike;
	sendRequestSkills: (socket: SocketLike) => void;
	setRuntimeError: (error: string | null) => void;
}

export interface SidebarRefreshCoordinator {
	invalidate: () => void;
	refresh: () => void;
	refreshAgentSessions: (agentId: string) => void;
}

export function createSidebarRefreshCoordinator<SocketLike>({
	applyAgentSessionPage,
	applySidebarSummary,
	fetchAgentSessionPage,
	fetchSidebarSummary,
	gate,
	getLoadedAgentSessionCount,
	getSocket,
	isSocketOpen,
	sendRequestSkills,
	setRuntimeError,
}: SidebarRefreshCoordinatorParams<SocketLike>): SidebarRefreshCoordinator {
	let agentRequestSequence = 0;
	const currentAgentRequestById = new Map<string, number>();

	return {
		invalidate: () => {
			gate.invalidate();
			agentRequestSequence += 1;
			currentAgentRequestById.clear();
		},
		refresh: () => {
			const requestId = gate.startRequest();
			void fetchSidebarSummary()
				.then((summary) => {
					if (!gate.isCurrent(requestId)) {
						return;
					}
					applySidebarSummary(summary);
				})
				.catch((error) => {
					if (!gate.isCurrent(requestId)) {
						return;
					}
					setRuntimeError(extractError(error));
				});

			const socket = getSocket();
			if (!isSocketOpen(socket)) {
				return;
			}

			try {
				sendRequestSkills(socket);
			} catch (error) {
				setRuntimeError(extractError(error));
			}
		},
		refreshAgentSessions: (agentId) => {
			agentRequestSequence += 1;
			const requestId = agentRequestSequence;
			currentAgentRequestById.set(agentId, requestId);
			const limit = resolveAgentSessionRefreshLimit(
				getLoadedAgentSessionCount(agentId),
			);
			void fetchAgentSessionPage(agentId, { limit })
				.then((page) => {
					if (currentAgentRequestById.get(agentId) !== requestId) {
						return;
					}
					applyAgentSessionPage(agentId, page);
				})
				.catch((error) => {
					if (currentAgentRequestById.get(agentId) !== requestId) {
						return;
					}
					setRuntimeError(extractError(error));
				});
		},
	};
}

function resolveAgentSessionRefreshLimit(loadedCount: number): number {
	return Math.min(
		MAX_AGENT_SESSION_REFRESH_LIMIT,
		Math.max(DEFAULT_AGENT_SESSION_REFRESH_LIMIT, loadedCount),
	);
}
