import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Config {
	autoCompact: boolean;
	heartbeat: {
		intervalMinutes: number;
		deferMinutes: number;
	};
	port: number;
	telegram: {
		botToken: string;
		allowedUsers: number[];
	};
}

const DEFAULTS: Config = {
	autoCompact: true,
	heartbeat: {
		intervalMinutes: 30,
		deferMinutes: 0,
	},
	port: 4000,
	telegram: {
		botToken: "",
		allowedUsers: [],
	},
};

function loadEnvFile(homeDir: string): void {
	const envPath = join(homeDir, ".env");
	if (!existsSync(envPath)) return;

	const content = readFileSync(envPath, "utf-8");
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eqIdx = trimmed.indexOf("=");
		if (eqIdx === -1) continue;
		const key = trimmed.slice(0, eqIdx).trim();
		const value = trimmed.slice(eqIdx + 1).trim();
		if (!process.env[key]) {
			process.env[key] = value;
		}
	}
}

function resolveEnv(value: string): string {
	if (value.startsWith("$")) {
		return process.env[value.slice(1)] ?? "";
	}
	return value;
}

function resolveAllowedUsers(value: unknown): number[] {
	if (Array.isArray(value)) return value;
	if (typeof value === "string") {
		const resolved = resolveEnv(value);
		if (!resolved) return [];
		return resolved.split(",").map(Number).filter(Boolean);
	}
	return [];
}

export function loadConfig(homeDir: string): Config {
	loadEnvFile(homeDir);
	const configPath = join(homeDir, "config.json");

	if (!existsSync(configPath)) {
		writeFileSync(configPath, `${JSON.stringify(DEFAULTS, null, "\t")}\n`);
		return { ...DEFAULTS, telegram: { ...DEFAULTS.telegram } };
	}

	const raw = JSON.parse(readFileSync(configPath, "utf-8"));

	const merged = {
		autoCompact: raw.autoCompact ?? DEFAULTS.autoCompact,
		heartbeat: {
			intervalMinutes:
				raw.heartbeat?.intervalMinutes ?? DEFAULTS.heartbeat.intervalMinutes,
			deferMinutes:
				raw.heartbeat?.deferMinutes ?? DEFAULTS.heartbeat.deferMinutes,
		},
		port: raw.port ?? DEFAULTS.port,
		telegram: {
			botToken: raw.telegram?.botToken ?? DEFAULTS.telegram.botToken,
			allowedUsers:
				raw.telegram?.allowedUsers ?? DEFAULTS.telegram.allowedUsers,
		},
	};

	if (JSON.stringify(merged) !== JSON.stringify(raw)) {
		writeFileSync(configPath, `${JSON.stringify(merged, null, "\t")}\n`);
	}

	return {
		...merged,
		telegram: {
			botToken: resolveEnv(merged.telegram.botToken),
			allowedUsers: resolveAllowedUsers(merged.telegram.allowedUsers),
		},
	};
}
