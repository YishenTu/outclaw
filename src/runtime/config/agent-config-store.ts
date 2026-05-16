import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
	DEFAULT_STORED_AGENT_CONFIG,
	normalizeStoredAgentConfig,
	type StoredAgentConfig,
} from "../agents/config/agent-config.ts";
import {
	configPathFor,
	ensureConfigHomeDir,
	normalizeConfigDocument,
} from "./config-document.ts";

export function readStoredAgentConfig(
	homeDir: string,
	agentId: string,
): StoredAgentConfig {
	const configPath = configPathFor(homeDir);
	const raw = existsSync(configPath)
		? (JSON.parse(readFileSync(configPath, "utf-8")) as unknown)
		: {};
	const normalized = normalizeConfigDocument(raw);
	const existing = normalized.agents?.[agentId];
	if (existing) {
		return existing;
	}

	writeStoredAgentConfig(homeDir, agentId, DEFAULT_STORED_AGENT_CONFIG);
	return DEFAULT_STORED_AGENT_CONFIG;
}

export function writeStoredAgentConfig(
	homeDir: string,
	agentId: string,
	config: StoredAgentConfig,
): string {
	const configPath = configPathFor(homeDir);
	const raw = existsSync(configPath)
		? (JSON.parse(readFileSync(configPath, "utf-8")) as unknown)
		: {};
	const normalized = normalizeConfigDocument(raw);
	const nextConfig = normalizeStoredAgentConfig(config);
	const nextDocument = {
		...normalized,
		agents: {
			...(normalized.agents ?? {}),
			[agentId]: nextConfig,
		},
	};
	ensureConfigHomeDir(homeDir);
	writeFileSync(configPath, `${JSON.stringify(nextDocument, null, "\t")}\n`);
	return configPath;
}

export function deleteStoredAgentConfig(
	homeDir: string,
	agentId: string,
): void {
	const configPath = configPathFor(homeDir);
	if (!existsSync(configPath)) {
		return;
	}

	const raw = JSON.parse(readFileSync(configPath, "utf-8")) as unknown;
	const normalized = normalizeConfigDocument(raw);
	if (!normalized.agents || !(agentId in normalized.agents)) {
		return;
	}

	const { [agentId]: _deleted, ...remainingAgents } = normalized.agents;
	const nextDocument = {
		...normalized,
		agents: remainingAgents,
	};
	writeFileSync(configPath, `${JSON.stringify(nextDocument, null, "\t")}\n`);
}
