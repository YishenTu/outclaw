export interface AgentSummary {
	agentId: string;
	name: string;
}

export interface AgentMenuData {
	activeAgentId: string;
	activeAgentName: string;
	agents: AgentSummary[];
}
