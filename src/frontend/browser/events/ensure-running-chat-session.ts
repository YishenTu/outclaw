import { resolveCurrentBrowserSessionKey } from "../session.ts";
import { useChatStore } from "../stores/chat.ts";
import { useRuntimeStore } from "../stores/runtime.ts";
import { useSessionsStore } from "../stores/sessions.ts";

export function ensureRunningChatSession(
	agentId: string,
	providerId?: string | null,
) {
	const activeSession =
		useSessionsStore.getState().activeSessionByAgent[agentId] ?? null;
	const runtimeSessionId = useRuntimeStore.getState().sessionId;
	const sessionKey = resolveCurrentBrowserSessionKey({
		agentId,
		activeSession,
		providerId: providerId ?? undefined,
		runtimeSessionId,
	});
	useChatStore.getState().startAssistantTurn(sessionKey);
}
