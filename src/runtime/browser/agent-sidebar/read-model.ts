import type { BrowserAgentsResponse } from "../../../common/protocol.ts";
import type { SessionStore } from "../../persistence/session-store/session-store.ts";

export interface BrowserApiAgent {
	agentId: string;
	name: string;
	homeDir: string;
	providerId: string;
	terminalRunCommand: string;
}

export function listBrowserAgents(params: {
	agents: Iterable<BrowserApiAgent>;
	getRememberedAgentId: () => string | undefined;
	storesByAgent: Map<string, SessionStore | undefined>;
}): BrowserAgentsResponse {
	return {
		activeAgentId: params.getRememberedAgentId(),
		agents: [...params.agents]
			.sort((left, right) => left.name.localeCompare(right.name))
			.map((agent) => {
				const store = params.storesByAgent.get(agent.agentId);
				const sessions =
					store?.list(50, "chat").map((session) => ({
						providerId: session.providerId,
						sdkSessionId: session.sdkSessionId,
						title: session.title,
						model: session.model,
						lastActive: session.lastActive,
					})) ?? [];
				const activeSessionId = store?.getActiveSessionId(agent.providerId);
				return {
					agentId: agent.agentId,
					name: agent.name,
					terminalRunCommand: agent.terminalRunCommand,
					activeSession: activeSessionId
						? {
								providerId: agent.providerId,
								sdkSessionId: activeSessionId,
							}
						: undefined,
					sessions,
				};
			}),
	};
}
