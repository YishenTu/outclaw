export const LAST_TUI_AGENT_KEY = "last_tui_agent_id";

export function activeSessionKey(agentId: string, providerId: string): string {
	return `active_session_id:${agentId}:${providerId}`;
}

export function lastUserTargetKey(agentId: string): string {
	return `last_user_target:${agentId}`;
}
