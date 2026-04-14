export const LAST_TUI_AGENT_KEY = "last_tui_agent_id";

export function activeSessionKey(agentId: string, providerId: string): string {
	return `active_session_id:${agentId}:${providerId}`;
}

export function lastTelegramDeliveryKey(agentId: string): string {
	return `last_telegram_delivery:${agentId}`;
}
