import { existsSync, rmSync } from "node:fs";
import { assertValidAgentName } from "../../common/agent-name.ts";
import { createOutclawLayout } from "../../common/layout.ts";
import { deleteStoredAgentConfig } from "../config.ts";
import { SessionStore } from "../persistence/session-store/session-store.ts";
import { TelegramRouteStore } from "../persistence/telegram-route-store.ts";
import { readAgentId } from "./read-agent-id.ts";

interface RemoveAgentOptions {
	homeDir: string;
	name: string;
}

export function removeAgent(options: RemoveAgentOptions) {
	assertValidAgentName(options.name);

	const agentHomeDir = createOutclawLayout({
		homeDir: options.homeDir,
	}).agent(options.name).homeDir;
	if (!existsSync(agentHomeDir)) {
		throw new Error(`Agent does not exist: ${options.name}`);
	}

	const agentId = readAgentId(agentHomeDir);
	deleteAgentPersistence(options.homeDir, agentId);
	deleteStoredAgentConfig(options.homeDir, agentId);
	rmSync(agentHomeDir, { recursive: true });
}

function deleteAgentPersistence(homeDir: string, agentId: string) {
	const dbPath = createOutclawLayout({ homeDir }).dbPath;
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
