import { resolveBrowserSessionKey } from "./session.ts";
import { useChatStore } from "./stores/chat.ts";
import { useSessionsStore } from "./stores/sessions.ts";

export function ensureRunningChatSession(
	agentId: string,
	providerId?: string | null,
) {
	const activeSession =
		useSessionsStore.getState().activeSessionByAgent[agentId] ?? null;
	const sessionKey = resolveBrowserSessionKey({
		agentId,
		activeSession,
		providerId: providerId ?? undefined,
	});
	useChatStore.getState().startAssistantTurn(sessionKey);
}
