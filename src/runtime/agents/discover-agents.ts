import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { assertValidAgentName } from "./agent-name.ts";
import type { AgentRecord } from "./agent-record.ts";
import { readAgentConfig } from "./read-agent-config.ts";
import { readAgentId } from "./read-agent-id.ts";

export function discoverAgents(homeDir: string): AgentRecord[] {
	const agentsDir = join(homeDir, "agents");
	if (!existsSync(agentsDir)) {
		return [];
	}

	const records = readdirSync(agentsDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => {
			assertValidAgentName(entry.name);
			const agentHomeDir = join(agentsDir, entry.name);
			const agentId = readAgentId(agentHomeDir);
			return {
				agentId,
				name: entry.name,
				homeDir: agentHomeDir,
				promptHomeDir: agentHomeDir,
				configPath: join(homeDir, "config.json"),
				config: readAgentConfig({
					agentId,
					homeDir,
				}),
			};
		});

	return records.sort((left, right) => left.name.localeCompare(right.name));
}
