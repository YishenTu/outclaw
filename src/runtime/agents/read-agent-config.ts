import {
	loadSharedEnv,
	resolveAllowedUsers,
	resolveEnvString,
} from "../config/env.ts";
import { readStoredAgentConfig } from "../config.ts";
import type { AgentConfig } from "./agent-config.ts";

export type { AgentConfig, StoredAgentConfig } from "./agent-config.ts";

export function readAgentConfig(options: {
	agentId: string;
	homeDir: string;
}): AgentConfig {
	loadSharedEnv(options.homeDir);
	const stored = readStoredAgentConfig(options.homeDir, options.agentId);

	return {
		telegram: {
			botToken: resolveEnvString(stored.telegram?.botToken ?? ""),
			allowedUsers: resolveAllowedUsers(stored.telegram?.allowedUsers ?? []),
		},
	};
}
