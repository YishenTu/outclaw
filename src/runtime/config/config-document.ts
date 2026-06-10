import { mkdirSync } from "node:fs";
import {
	DEFAULT_EFFORT,
	type EffortLevel,
	isEffortLevel,
} from "../../common/commands.ts";
import { createOutclawLayout } from "../../common/layout.ts";
import {
	normalizeStoredAgentConfig,
	type StoredAgentConfig,
} from "../agents/config/agent-config.ts";

export interface ConfigDocument extends Record<string, unknown> {
	agents?: Record<string, StoredAgentConfig>;
	autoTitle?: {
		model?: string;
	};
	heartbeat?: {
		intervalMinutes?: number;
		deferMinutes?: number;
	};
	host?: string;
	port?: number;
	thinkingEffort?: EffortLevel;
}

export const DEFAULT_GLOBAL_CONFIG = {
	heartbeat: {
		intervalMinutes: 30,
		deferMinutes: 0,
	},
	host: "127.0.0.1",
	port: 4000,
	thinkingEffort: DEFAULT_EFFORT,
} as const;

export function ensureConfigHomeDir(homeDir: string) {
	mkdirSync(homeDir, { recursive: true });
}

export function configPathFor(homeDir: string): string {
	return createOutclawLayout({ homeDir }).configPath;
}

export function normalizeConfigDocument(raw: unknown): ConfigDocument {
	const document = isObject(raw) ? raw : {};
	const { autoCompact: _autoCompact, ...documentWithoutObsoleteFields } =
		document;
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
		...documentWithoutObsoleteFields,
		...(normalizedAgents ? { agents: normalizedAgents } : {}),
		host:
			typeof document.host === "string" && document.host.trim() !== ""
				? document.host
				: DEFAULT_GLOBAL_CONFIG.host,
		heartbeat: {
			...heartbeat,
			intervalMinutes:
				typeof heartbeat.intervalMinutes === "number"
					? heartbeat.intervalMinutes
					: DEFAULT_GLOBAL_CONFIG.heartbeat.intervalMinutes,
			deferMinutes:
				typeof heartbeat.deferMinutes === "number"
					? heartbeat.deferMinutes
					: DEFAULT_GLOBAL_CONFIG.heartbeat.deferMinutes,
		},
		port:
			typeof document.port === "number"
				? document.port
				: DEFAULT_GLOBAL_CONFIG.port,
		thinkingEffort:
			typeof document.thinkingEffort === "string" &&
			isEffortLevel(document.thinkingEffort)
				? document.thinkingEffort
				: DEFAULT_GLOBAL_CONFIG.thinkingEffort,
	};
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
