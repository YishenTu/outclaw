import {
	type BrowserAgentsResponse,
	extractError,
} from "../../../common/protocol.ts";
import type { SidebarRefreshGate } from "./sidebar-refresh-gate.ts";

interface SidebarRefreshCoordinatorParams<SocketLike> {
	applySidebarSummary: (summary: BrowserAgentsResponse) => void;
	fetchSidebarSummary: () => Promise<BrowserAgentsResponse>;
	gate: SidebarRefreshGate;
	getSocket: () => SocketLike | null;
	isSocketOpen: (socket: SocketLike | null) => socket is SocketLike;
	sendRequestSkills: (socket: SocketLike) => void;
	setRuntimeError: (error: string | null) => void;
}

export interface SidebarRefreshCoordinator {
	invalidate: () => void;
	refresh: () => void;
}

export function createSidebarRefreshCoordinator<SocketLike>({
	applySidebarSummary,
	fetchSidebarSummary,
	gate,
	getSocket,
	isSocketOpen,
	sendRequestSkills,
	setRuntimeError,
}: SidebarRefreshCoordinatorParams<SocketLike>): SidebarRefreshCoordinator {
	return {
		invalidate: () => {
			gate.invalidate();
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
	};
}
