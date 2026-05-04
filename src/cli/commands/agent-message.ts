import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listAgents } from "../../runtime/agents/list-agents.ts";

export interface AgentMessageArgs {
	message?: string;
	target?: string;
}

export function parseAgentMessageArgs(args: string[]): AgentMessageArgs {
	let target: string | undefined;
	let parseFlags = true;
	const messageParts: string[] = [];
	let valid = true;

	for (let index = 0; index < args.length; index += 1) {
		const value = args[index];
		if (!value) {
			continue;
		}
		if (parseFlags && value === "--") {
			parseFlags = false;
			continue;
		}
		if (parseFlags && value === "--to") {
			const nextValue = args[index + 1];
			if (!nextValue || nextValue.startsWith("--")) {
				valid = false;
				break;
			}
			target = nextValue;
			index += 1;
			continue;
		}
		if (parseFlags && value.startsWith("--")) {
			valid = false;
			break;
		}
		messageParts.push(value);
	}

	return {
		message:
			valid && messageParts.length > 0 ? messageParts.join(" ") : undefined,
		target: valid ? target : undefined,
	};
}

export function resolveSenderAgent(
	homeDir: string,
	cwd: string,
): { agentId: string; name: string } | undefined {
	const agentIdPath = join(cwd, ".agent-id");
	if (!existsSync(agentIdPath)) {
		return undefined;
	}
	const agentId = readFileSync(agentIdPath, "utf-8").trim();
	if (!agentId) {
		return undefined;
	}
	return listAgents(homeDir).find((agent) => agent.agentId === agentId);
}
