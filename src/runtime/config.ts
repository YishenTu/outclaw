import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	DEFAULT_STORED_AGENT_CONFIG,
	normalizeStoredAgentConfig,
	type StoredAgentConfig,
} from "./agents/agent-config.ts";
import { loadSharedEnv } from "./config/env.ts";

export interface GlobalConfig {
	autoCompact: boolean;
	heartbeat: {
		intervalMinutes: number;
		deferMinutes: number;
	};
	port: number;
}

export type Config = GlobalConfig;

const DEFAULTS: GlobalConfig = {
	autoCompact: true,
	heartbeat: {
		intervalMinutes: 30,
		deferMinutes: 0,
	},
	port: 4000,
};

interface ConfigDocument extends Record<string, unknown> {
	agents?: Record<string, StoredAgentConfig>;
	autoCompact?: boolean;
	heartbeat?: {
		intervalMinutes?: number;
		deferMinutes?: number;
	};
	port?: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeConfigDocument(raw: unknown): ConfigDocument {
	const document = isObject(raw) ? raw : {};
	const heartbeat = isObject(document.heartbeat) ? document.heartbeat : {};
	const agents = isObject(document.agents) ? document.agents : {};
	const normalizedAgents = isObject(document.agents)
		? Object.fromEntries(
				Object.entries(agents).map(([agentId, config]) => [
					agentId,
					normalizeStoredAgentConfig(config),
				]),
			)
		: undefined;

	return {
		...document,
		...(normalizedAgents ? { agents: normalizedAgents } : {}),
		autoCompact:
			typeof document.autoCompact === "boolean"
				? document.autoCompact
				: DEFAULTS.autoCompact,
		heartbeat: {
			...heartbeat,
			intervalMinutes:
				typeof heartbeat.intervalMinutes === "number"
					? heartbeat.intervalMinutes
					: DEFAULTS.heartbeat.intervalMinutes,
			deferMinutes:
				typeof heartbeat.deferMinutes === "number"
					? heartbeat.deferMinutes
					: DEFAULTS.heartbeat.deferMinutes,
		},
		port: typeof document.port === "number" ? document.port : DEFAULTS.port,
	};
}

export function loadGlobalConfig(homeDir: string): GlobalConfig {
	loadSharedEnv(homeDir);
	const configPath = join(homeDir, "config.json");

	if (!existsSync(configPath)) {
		writeFileSync(configPath, `${JSON.stringify(DEFAULTS, null, "\t")}\n`);
		return {
			autoCompact: DEFAULTS.autoCompact,
			heartbeat: { ...DEFAULTS.heartbeat },
			port: DEFAULTS.port,
		};
	}

	const raw = JSON.parse(readFileSync(configPath, "utf-8")) as unknown;
	const merged = normalizeConfigDocument(raw);

	if (JSON.stringify(merged) !== JSON.stringify(raw)) {
		writeFileSync(configPath, `${JSON.stringify(merged, null, "\t")}\n`);
	}

	return {
		autoCompact: merged.autoCompact ?? DEFAULTS.autoCompact,
		heartbeat: {
			intervalMinutes:
				merged.heartbeat?.intervalMinutes ?? DEFAULTS.heartbeat.intervalMinutes,
			deferMinutes:
				merged.heartbeat?.deferMinutes ?? DEFAULTS.heartbeat.deferMinutes,
		},
		port: merged.port ?? DEFAULTS.port,
	};
}

export const loadConfig = loadGlobalConfig;

export function readStoredAgentConfig(
	homeDir: string,
	agentId: string,
): StoredAgentConfig {
	const configPath = join(homeDir, "config.json");
	const raw = existsSync(configPath)
		? (JSON.parse(readFileSync(configPath, "utf-8")) as unknown)
		: {};
	const normalized = normalizeConfigDocument(raw);
	const nextConfig =
		normalized.agents?.[agentId] ?? DEFAULT_STORED_AGENT_CONFIG;

	if (
		JSON.stringify(normalized.agents?.[agentId]) !== JSON.stringify(nextConfig)
	) {
		writeStoredAgentConfig(homeDir, agentId, nextConfig);
	}

	return nextConfig;
}

export function writeStoredAgentConfig(
	homeDir: string,
	agentId: string,
	config: StoredAgentConfig,
): string {
	const configPath = join(homeDir, "config.json");
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
	writeFileSync(configPath, `${JSON.stringify(nextDocument, null, "\t")}\n`);
	return configPath;
}

export function deleteStoredAgentConfig(
	homeDir: string,
	agentId: string,
): void {
	const configPath = join(homeDir, "config.json");
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
