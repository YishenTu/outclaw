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
