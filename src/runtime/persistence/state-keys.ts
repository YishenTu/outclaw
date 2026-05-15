export const LAST_INTERACTIVE_AGENT_KEY = "last_interactive_agent_id";
export const LEGACY_LAST_TUI_AGENT_KEY = "last_tui_agent_id";
export const FRONTEND_NOTICE_KEY = "frontend_notice";

export function activeSessionKey(agentId: string, providerId: string): string {
	return `active_session_id:${agentId}:${providerId}`;
}

export function lastUserTargetKey(agentId: string): string {
	return `last_user_target:${agentId}`;
}

export function lastInteractiveAtKey(agentId: string): string {
	return `last_interactive_at:${agentId}`;
}

export function lastHandledRolloverInteractiveAtKey(agentId: string): string {
	return `last_handled_rollover_interactive_at:${agentId}`;
}

export function rolloverNoticeKey(agentId: string): string {
	return `rollover_notice:${agentId}`;
}

export function browserClientAgentKey(clientId: string): string {
	return `browser_client_agent:${clientId}`;
}

/**
 * Per-agent "what provider/model would a new chat session use right now?".
 * This key is the single source of the blank-session selection: which
 * provider and model would be picked on `/new`, and after daemon restart
 * which provider's `active_session_id:{agentId}:{providerId}` row is visible.
 *
 * Do not add a separate `active_chat_provider_id:{agentId}` key — derive the
 * visible provider from this selection plus the matching active-session row.
 */
export function blankChatModelSelectionKey(agentId: string): string {
	return `blank_chat_model_selection:${agentId}`;
}
