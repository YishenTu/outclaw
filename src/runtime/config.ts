import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
	host: string;
	port: number;
}

export type Config = GlobalConfig;

export interface GlobalConfigPatch {
	autoCompact?: boolean;
	heartbeat?: {
		intervalMinutes?: number;
		deferMinutes?: number;
	};
	host?: string;
	port?: number;
}

const DEFAULTS: GlobalConfig = {
	autoCompact: true,
	heartbeat: {
		intervalMinutes: 30,
		deferMinutes: 0,
	},
	host: "127.0.0.1",
	port: 4000,
};

function ensureConfigHomeDir(homeDir: string) {
	mkdirSync(homeDir, { recursive: true });
}

interface ConfigDocument extends Record<string, unknown> {
	agents?: Record<string, StoredAgentConfig>;
	autoCompact?: boolean;
	heartbeat?: {
		intervalMinutes?: number;
		deferMinutes?: number;
	};
	host?: string;
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
		host:
			typeof document.host === "string" && document.host.trim() !== ""
				? document.host
				: DEFAULTS.host,
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
		ensureConfigHomeDir(homeDir);
		writeFileSync(configPath, `${JSON.stringify(DEFAULTS, null, "\t")}\n`);
		return {
			autoCompact: DEFAULTS.autoCompact,
			heartbeat: { ...DEFAULTS.heartbeat },
			host: DEFAULTS.host,
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
		host: merged.host ?? DEFAULTS.host,
		port: merged.port ?? DEFAULTS.port,
	};
}

export const loadConfig = loadGlobalConfig;

export function updateGlobalConfig(
	homeDir: string,
	patch: GlobalConfigPatch,
): GlobalConfig {
	const configPath = join(homeDir, "config.json");
	const raw = existsSync(configPath)
		? (JSON.parse(readFileSync(configPath, "utf-8")) as unknown)
		: {};
	const normalized = normalizeConfigDocument(raw);
	const nextDocument = {
		...normalized,
		...(patch.autoCompact !== undefined
			? { autoCompact: patch.autoCompact }
			: {}),
		...(patch.host !== undefined ? { host: patch.host } : {}),
		...(patch.port !== undefined ? { port: patch.port } : {}),
		heartbeat: {
			...normalized.heartbeat,
			...(patch.heartbeat?.intervalMinutes !== undefined
				? { intervalMinutes: patch.heartbeat.intervalMinutes }
				: {}),
			...(patch.heartbeat?.deferMinutes !== undefined
				? { deferMinutes: patch.heartbeat.deferMinutes }
				: {}),
		},
	};
	ensureConfigHomeDir(homeDir);
	writeFileSync(configPath, `${JSON.stringify(nextDocument, null, "\t")}\n`);

	return {
		autoCompact: nextDocument.autoCompact ?? DEFAULTS.autoCompact,
		heartbeat: {
			intervalMinutes:
				nextDocument.heartbeat?.intervalMinutes ??
				DEFAULTS.heartbeat.intervalMinutes,
			deferMinutes:
				nextDocument.heartbeat?.deferMinutes ?? DEFAULTS.heartbeat.deferMinutes,
		},
		host: nextDocument.host ?? DEFAULTS.host,
		port: nextDocument.port ?? DEFAULTS.port,
	};
}

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
	ensureConfigHomeDir(homeDir);
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
