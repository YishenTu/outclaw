import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

export function readAgentId(agentHomeDir: string): string {
	const agentIdPath = join(agentHomeDir, ".agent-id");
	if (!existsSync(agentIdPath)) {
		throw new Error(
			`Agent folder ${basename(agentHomeDir)} is missing .agent-id`,
		);
	}

	const agentId = readFileSync(agentIdPath, "utf-8").trim();
	if (!agentId) {
		throw new Error(
			`Agent folder ${basename(agentHomeDir)} has an empty .agent-id`,
		);
	}

	return agentId;
}
