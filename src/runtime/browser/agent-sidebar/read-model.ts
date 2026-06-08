import type {
	BrowserAgentsResponse,
	BrowserSessionSummary,
} from "../../../common/protocol.ts";
import { nextSessionCursor } from "../../persistence/session-cursor.ts";
import type { SessionStore } from "../../persistence/session-store/session-store.ts";
import type { SessionRow } from "../../persistence/session-store/session-store-records.ts";

export interface BrowserApiAgent {
	agentId: string;
	name: string;
	homeDir: string;
	providerId: string;
	terminalRunCommand: string;
}

const BROWSER_SESSION_PAGE_SIZE = 10;

export function toBrowserSessionSummary(
	row: SessionRow,
): BrowserSessionSummary {
	return {
		providerId: row.providerId,
		sdkSessionId: row.sdkSessionId,
		title: row.title,
		model: row.model,
		lastActive: row.lastActive,
	};
}

export function listBrowserAgents(params: {
	activeAgentId?: string;
	agents: Iterable<BrowserApiAgent>;
	storesByAgent: Map<string, SessionStore | undefined>;
}): BrowserAgentsResponse {
	return {
		activeAgentId: params.activeAgentId,
		agents: [...params.agents]
			.sort((left, right) => left.name.localeCompare(right.name))
			.map((agent) => {
				const store = params.storesByAgent.get(agent.agentId);
				const sessionRows =
					store?.list({
						limit: BROWSER_SESSION_PAGE_SIZE,
						tag: "chat",
					}) ?? [];
				const sessions = sessionRows.map(toBrowserSessionSummary);
				const activeSession = resolveVisibleActiveChatSession(agent, store);
				return {
					agentId: agent.agentId,
					name: agent.name,
					terminalRunCommand: agent.terminalRunCommand,
					activeSession,
					nextSessionCursor: nextSessionCursor(
						sessionRows,
						BROWSER_SESSION_PAGE_SIZE,
					),
					sessions,
				};
			}),
	};
}

export function resolveVisibleActiveChatSession(
	agent: BrowserApiAgent,
	store: SessionStore | undefined,
): { providerId: string; sdkSessionId: string } | undefined {
	if (!store) {
		return undefined;
	}

	const activeSession =
		getActiveChatSessionForProvider(store, store.getActiveChatProviderId()) ??
		getActiveChatSessionForProvider(
			store,
			store.getBlankChatModelSelection()?.providerId,
		) ??
		getActiveChatSessionForProvider(
			store,
			store.findVisibleActiveChatProviderId(),
		) ??
		getActiveChatSessionForProvider(store, agent.providerId);
	if (!activeSession) {
		return undefined;
	}

	return {
		providerId: activeSession.providerId,
		sdkSessionId: activeSession.sdkSessionId,
	};
}

function getActiveChatSessionForProvider(
	store: SessionStore,
	providerId: string | undefined,
): SessionRow | undefined {
	if (!providerId) {
		return undefined;
	}

	const activeSessionId = store.getActiveSessionId(providerId);
	if (!activeSessionId) {
		return undefined;
	}

	const activeSession = store.get(providerId, activeSessionId);
	if (!activeSession || activeSession.tag !== "chat") {
		return undefined;
	}

	return activeSession;
}
