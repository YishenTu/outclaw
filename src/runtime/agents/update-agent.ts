import { existsSync } from "node:fs";
import { join } from "node:path";
import { upsertSharedEnvEntries } from "../config/env.ts";
import { readStoredAgentConfig, writeStoredAgentConfig } from "../config.ts";
import type { StoredAgentConfig } from "./agent-config.ts";
import { assertValidAgentName } from "./agent-name.ts";
import { readAgentId } from "./read-agent-id.ts";

interface UpdateAgentOptions {
	homeDir: string;
	name: string;
	botToken?: string;
	allowedUsers?: number[];
}

export function updateAgent(options: UpdateAgentOptions) {
	assertValidAgentName(options.name);

	const agentHomeDir = join(options.homeDir, "agents", options.name);
	if (!existsSync(agentHomeDir)) {
		throw new Error(`Agent does not exist: ${options.name}`);
	}

	const agentId = readAgentId(agentHomeDir);
	const stored = readStoredAgentConfig(options.homeDir, agentId);
	const currentTelegram = stored.telegram ?? {};
	const envEntries: Record<string, string> = {};

	const merged = {
		...stored,
		telegram: {
			...currentTelegram,
			...(options.botToken !== undefined
				? {
						botToken: preserveStoredString(
							currentTelegram.botToken ?? "",
							options.botToken,
							envEntries,
						),
					}
				: {}),
			...(options.allowedUsers !== undefined
				? {
						allowedUsers: preserveStoredAllowedUsers(
							currentTelegram.allowedUsers,
							options.allowedUsers,
							envEntries,
						),
					}
				: {}),
		},
	};

	const configPath = writeStoredAgentConfig(options.homeDir, agentId, merged);
	if (Object.keys(envEntries).length > 0) {
		upsertSharedEnvEntries(options.homeDir, envEntries);
	}
	return { agentHomeDir, agentId, configPath };
}

function preserveStoredString(
	currentValue: string,
	nextValue: string,
	envEntries: Record<string, string>,
) {
	if (currentValue.startsWith("$")) {
		envEntries[currentValue.slice(1)] = nextValue;
		return currentValue;
	}
	return nextValue;
}

function preserveStoredAllowedUsers(
	currentValue: StoredAgentConfig["telegram"] extends infer T
		? T extends { allowedUsers?: infer U }
			? U | undefined
			: undefined
		: undefined,
	nextValue: number[],
	envEntries: Record<string, string>,
) {
	if (typeof currentValue === "string" && currentValue.startsWith("$")) {
		envEntries[currentValue.slice(1)] = nextValue.join(",");
		return currentValue;
	}
	return nextValue;
}
