import { discoverAgents } from "./discover-agents.ts";

export function listAgents(homeDir: string) {
	return discoverAgents(homeDir);
}
