import {
	agentTelegramBotTokenEnvKey,
	agentTelegramUsersEnvKey,
} from "../agents/agent-config-env.ts";
import { discoverAgents } from "../agents/discover-agents.ts";
import { readStoredAgentConfig, writeStoredAgentConfig } from "../config.ts";
import { upsertSharedEnvEntries } from "./env.ts";

interface ConfigSecureChange {
	envKey: string;
	path: string;
}

export interface ConfigSecureResult {
	changes: ConfigSecureChange[];
}

export function secureAgentConfig(homeDir: string): ConfigSecureResult {
	const changes: ConfigSecureChange[] = [];
	const envEntries: Record<string, string> = {};

	for (const agent of discoverAgents(homeDir)) {
		const stored = readStoredAgentConfig(homeDir, agent.agentId);
		let changed = false;
		const nextConfig = structuredClone(stored);

		const botToken = stored.telegram?.botToken;
		if (
			typeof botToken === "string" &&
			botToken !== "" &&
			!botToken.startsWith("$")
		) {
			const envKey = agentTelegramBotTokenEnvKey(agent.name);
			envEntries[envKey] = botToken;
			nextConfig.telegram ??= {};
			nextConfig.telegram.botToken = `$${envKey}`;
			changes.push({
				envKey,
				path: `agents/${agent.name}.telegram.botToken`,
			});
			changed = true;
		}

		const allowedUsers = stored.telegram?.allowedUsers;
		if (Array.isArray(allowedUsers) && allowedUsers.length > 0) {
			const envKey = agentTelegramUsersEnvKey(agent.name);
			envEntries[envKey] = allowedUsers.join(",");
			nextConfig.telegram ??= {};
			nextConfig.telegram.allowedUsers = `$${envKey}`;
			changes.push({
				envKey,
				path: `agents/${agent.name}.telegram.allowedUsers`,
			});
			changed = true;
		}

		if (
			typeof allowedUsers === "string" &&
			allowedUsers !== "" &&
			!allowedUsers.startsWith("$")
		) {
			const envKey = agentTelegramUsersEnvKey(agent.name);
			envEntries[envKey] = allowedUsers;
			nextConfig.telegram ??= {};
			nextConfig.telegram.allowedUsers = `$${envKey}`;
			changes.push({
				envKey,
				path: `agents/${agent.name}.telegram.allowedUsers`,
			});
			changed = true;
		}

		if (changed) {
			writeStoredAgentConfig(homeDir, agent.agentId, nextConfig);
		}
	}

	if (Object.keys(envEntries).length > 0) {
		upsertSharedEnvEntries(homeDir, envEntries);
	}

	return { changes };
}
