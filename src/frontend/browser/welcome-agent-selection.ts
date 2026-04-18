import type { AgentEntry } from "./stores/agents.ts";

export function resolveWelcomeAgentId(
	agents: AgentEntry[],
	activeAgentId: string | null,
): string | null {
	if (
		activeAgentId &&
		agents.some((agent) => agent.agentId === activeAgentId)
	) {
		return activeAgentId;
	}

	return agents[0]?.agentId ?? null;
}
