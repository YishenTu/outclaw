import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { EffortLevel } from "../../common/commands.ts";
import {
	configPathFor,
	DEFAULT_GLOBAL_CONFIG,
	ensureConfigHomeDir,
	normalizeConfigDocument,
} from "./config-document.ts";
import { loadSharedEnv } from "./env.ts";

export interface GlobalConfig {
	autoCompact: boolean;
	heartbeat: {
		intervalMinutes: number;
		deferMinutes: number;
	};
	host: string;
	port: number;
	thinkingEffort: EffortLevel;
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
	thinkingEffort?: EffortLevel;
}

const DEFAULTS: GlobalConfig = DEFAULT_GLOBAL_CONFIG;

export function loadGlobalConfig(homeDir: string): GlobalConfig {
	loadSharedEnv(homeDir);
	const configPath = configPathFor(homeDir);

	if (!existsSync(configPath)) {
		ensureConfigHomeDir(homeDir);
		writeFileSync(configPath, `${JSON.stringify(DEFAULTS, null, "\t")}\n`);
		return {
			autoCompact: DEFAULTS.autoCompact,
			heartbeat: { ...DEFAULTS.heartbeat },
			host: DEFAULTS.host,
			port: DEFAULTS.port,
			thinkingEffort: DEFAULTS.thinkingEffort,
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
		thinkingEffort: merged.thinkingEffort ?? DEFAULTS.thinkingEffort,
	};
}

export const loadConfig = loadGlobalConfig;

export function updateGlobalConfig(
	homeDir: string,
	patch: GlobalConfigPatch,
): GlobalConfig {
	const configPath = configPathFor(homeDir);
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
		...(patch.thinkingEffort !== undefined
			? { thinkingEffort: patch.thinkingEffort }
			: {}),
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
		thinkingEffort: nextDocument.thinkingEffort ?? DEFAULTS.thinkingEffort,
	};
}
