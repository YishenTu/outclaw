import { existsSync, readdirSync } from "node:fs";
import { assertValidAgentName } from "../../common/agent-name.ts";
import { createOutclawLayout } from "../../common/layout.ts";
import type { AgentRecord } from "./config/agent-record.ts";
import { readAgentConfig } from "./config/read-agent-config.ts";
import { readAgentId } from "./read-agent-id.ts";

export function discoverAgents(homeDir: string): AgentRecord[] {
	const layout = createOutclawLayout({ homeDir });
	const agentsDir = layout.agentsDir;
	if (!existsSync(agentsDir)) {
		return [];
	}

	const records = readdirSync(agentsDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => {
			assertValidAgentName(entry.name);
			const agentHomeDir = layout.agent(entry.name).homeDir;
			const agentId = readAgentId(agentHomeDir);
			return {
				agentId,
				name: entry.name,
				homeDir: agentHomeDir,
				promptHomeDir: agentHomeDir,
				configPath: layout.configPath,
				config: readAgentConfig({
					agentId,
					homeDir,
				}),
			};
		});

	return records.sort((left, right) => left.name.localeCompare(right.name));
}
