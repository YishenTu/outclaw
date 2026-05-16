import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { EffortLevel } from "../../common/commands.ts";
import {
	getModelAliasMetadata,
	modelAliasForModel,
} from "../../common/models.ts";
import {
	type ConfigDocument,
	configPathFor,
	DEFAULT_GLOBAL_CONFIG,
	ensureConfigHomeDir,
	normalizeConfigDocument,
} from "./config-document.ts";
import { loadSharedEnv } from "./env.ts";

export interface GlobalConfig {
	autoCompact: boolean;
	/**
	 * Optional global title-generation model. When omitted, the runtime
	 * disables generated titles and keeps the deterministic fallback title.
	 * Provider-specific model ids are accepted here; runtime model-catalog
	 * resolution owns provider validation.
	 */
	autoTitle?: {
		model: string;
	};
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

const DEFAULTS = DEFAULT_GLOBAL_CONFIG;

export function loadGlobalConfig(homeDir: string): GlobalConfig {
	loadSharedEnv(homeDir);
	const configPath = configPathFor(homeDir);

	if (!existsSync(configPath)) {
		ensureConfigHomeDir(homeDir);
		writeFileSync(configPath, `${JSON.stringify(DEFAULTS, null, "\t")}\n`);
		return globalConfigFromDocument(DEFAULTS);
	}

	const raw = JSON.parse(readFileSync(configPath, "utf-8")) as unknown;
	const merged = normalizeConfigDocument(raw);

	if (JSON.stringify(merged) !== JSON.stringify(raw)) {
		writeFileSync(configPath, `${JSON.stringify(merged, null, "\t")}\n`);
	}

	return globalConfigFromDocument(merged);
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

	return globalConfigFromDocument(nextDocument);
}

function globalConfigFromDocument(document: ConfigDocument): GlobalConfig {
	const autoTitleModel = resolveAutoTitleModel(document);
	return {
		autoCompact: document.autoCompact ?? DEFAULTS.autoCompact,
		...(autoTitleModel ? { autoTitle: { model: autoTitleModel } } : {}),
		heartbeat: {
			intervalMinutes:
				document.heartbeat?.intervalMinutes ??
				DEFAULTS.heartbeat.intervalMinutes,
			deferMinutes:
				document.heartbeat?.deferMinutes ?? DEFAULTS.heartbeat.deferMinutes,
		},
		host: document.host ?? DEFAULTS.host,
		port: document.port ?? DEFAULTS.port,
		thinkingEffort: document.thinkingEffort ?? DEFAULTS.thinkingEffort,
	};
}

function resolveAutoTitleModel(document: ConfigDocument): string | undefined {
	const autoTitle = document.autoTitle;
	const rawModel =
		autoTitle && typeof autoTitle.model === "string"
			? autoTitle.model.trim()
			: "";
	// Empty or omitted disables generated titles entirely. The runtime keeps
	// the deterministic fallback title and skips AutoTitleCoordinator.
	if (!rawModel) {
		return undefined;
	}

	const alias = getModelAliasMetadata(rawModel);
	if (alias) {
		return alias.id;
	}
	if (modelAliasForModel(rawModel)) {
		return rawModel;
	}
	return rawModel;
}
