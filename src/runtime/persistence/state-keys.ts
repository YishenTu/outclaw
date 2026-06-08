export const LAST_INTERACTIVE_AGENT_KEY = "last_interactive_agent_id";
export const LEGACY_LAST_TUI_AGENT_KEY = "last_tui_agent_id";
export const FRONTEND_NOTICE_KEY = "frontend_notice";

const ACTIVE_SESSION_KEY_PREFIX = "active_session_id:";

function encodeStateKeyComponent(value: string): string {
	return encodeURIComponent(value);
}

function decodeStateKeyComponent(value: string): string | undefined {
	try {
		return decodeURIComponent(value);
	} catch {
		return undefined;
	}
}

export function activeSessionKeyPrefix(agentId: string): string {
	return `${ACTIVE_SESSION_KEY_PREFIX}${encodeStateKeyComponent(agentId)}:`;
}

export function activeSessionKey(agentId: string, providerId: string): string {
	return `${activeSessionKeyPrefix(agentId)}${encodeStateKeyComponent(providerId)}`;
}

export function decodeActiveSessionProviderId(
	agentId: string,
	key: string,
): string | undefined {
	const prefix = activeSessionKeyPrefix(agentId);
	if (!key.startsWith(prefix)) {
		return undefined;
	}
	return decodeStateKeyComponent(key.slice(prefix.length));
}

export function activeChatProviderKey(agentId: string): string {
	return `active_chat_provider_id:${encodeStateKeyComponent(agentId)}`;
}

export function lastUserTargetKey(agentId: string): string {
	return `last_user_target:${encodeStateKeyComponent(agentId)}`;
}

export function lastInteractiveAtKey(agentId: string): string {
	return `last_interactive_at:${encodeStateKeyComponent(agentId)}`;
}

export function lastHandledRolloverInteractiveAtKey(agentId: string): string {
	return `last_handled_rollover_interactive_at:${encodeStateKeyComponent(agentId)}`;
}

export function rolloverNoticeKey(agentId: string): string {
	return `rollover_notice:${encodeStateKeyComponent(agentId)}`;
}

export function browserClientAgentKey(clientId: string): string {
	return `browser_client_agent:${encodeStateKeyComponent(clientId)}`;
}

/**
 * Per-agent "what provider/model would a new chat session use right now?".
 * This key is the single source of the blank-session selection: which
 * provider and model would be picked on `/new`. The currently visible active
 * session provider is tracked separately by `activeChatProviderKey()` because
 * read-only legacy sessions can be visible without becoming the writable
 * blank-session default.
 */
export function blankChatModelSelectionKey(agentId: string): string {
	return `blank_chat_model_selection:${encodeStateKeyComponent(agentId)}`;
}
