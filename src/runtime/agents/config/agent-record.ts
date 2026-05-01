import type { AgentConfig } from "./read-agent-config.ts";

export interface AgentRecord {
	agentId: string;
	name: string;
	homeDir: string;
	promptHomeDir: string;
	configPath: string;
	config: AgentConfig;
}
