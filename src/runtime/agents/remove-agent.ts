import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { deleteStoredAgentConfig } from "../config.ts";
import { SessionStore } from "../persistence/session-store.ts";
import { TelegramRouteStore } from "../persistence/telegram-route-store.ts";
import { assertValidAgentName } from "./agent-name.ts";
import { readAgentId } from "./read-agent-id.ts";

interface RemoveAgentOptions {
	homeDir: string;
	name: string;
}

export function removeAgent(options: RemoveAgentOptions) {
	assertValidAgentName(options.name);

	const agentHomeDir = join(options.homeDir, "agents", options.name);
	if (!existsSync(agentHomeDir)) {
		throw new Error(`Agent does not exist: ${options.name}`);
	}

	const agentId = readAgentId(agentHomeDir);
	deleteAgentPersistence(options.homeDir, agentId);
	deleteStoredAgentConfig(options.homeDir, agentId);
	rmSync(agentHomeDir, { recursive: true });
}

function deleteAgentPersistence(homeDir: string, agentId: string) {
	const dbPath = join(homeDir, "db.sqlite");
	if (!existsSync(dbPath)) {
		return;
	}

	const sessionStore = new SessionStore(dbPath);
	const telegramRouteStore = new TelegramRouteStore(dbPath);
	try {
		sessionStore.deleteAgentData(agentId);
		telegramRouteStore.deleteByAgentId(agentId);
	} finally {
		sessionStore.close();
		telegramRouteStore.close();
	}
}
