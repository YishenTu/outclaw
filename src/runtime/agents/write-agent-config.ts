import { writeStoredAgentConfig } from "../config.ts";
import type { StoredAgentConfig } from "./agent-config.ts";

interface WriteAgentConfigOptions {
	agentId: string;
	config: StoredAgentConfig;
	homeDir: string;
}

export function writeAgentConfig(options: WriteAgentConfigOptions): string {
	return writeStoredAgentConfig(
		options.homeDir,
		options.agentId,
		options.config,
	);
}
