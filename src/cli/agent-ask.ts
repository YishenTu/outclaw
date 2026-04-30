import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listAgents } from "../runtime/agents/list-agents.ts";
import { loadGlobalConfig } from "../runtime/config.ts";
import { requestControlMessage } from "./control-client.ts";
import { formatAgentAskUsage, printAgentAskUsage } from "./usage.ts";

export async function askAgentCommand(homeDir: string, argv: string[]) {
	const args = argv.slice(4);
	if (args.some((arg) => arg === "--help" || arg === "-h")) {
		printAgentAskUsage();
		process.exit(0);
	}
	const parsed = parseAskArgs(args);
	const target = parsed.target;
	const timeoutSeconds = parsed.timeoutSeconds;
	const message = parsed.message;
	if (!target || !message) {
		console.error(formatAgentAskUsage());
		process.exit(1);
	}

	const sender = resolveSenderAgent(homeDir, process.cwd());
	if (!sender) {
		console.error("cannot resolve sender agent from cwd");
		process.exit(1);
	}

	const config = loadGlobalConfig(homeDir);
	try {
		const text = await requestAgentResponse({
			message,
			port: config.port,
			senderAgentId: sender.agentId,
			target,
			timeoutSeconds,
		});
		console.log(text);
		process.exit(0);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.startsWith("TIMEOUT:")) {
			console.error(message.slice("TIMEOUT:".length));
			process.exit(124);
		}
		console.error(message);
		process.exit(1);
	}
}

export function parseAskArgs(args: string[]): {
	message?: string;
	target?: string;
	timeoutSeconds?: number;
} {
	let target: string | undefined;
	let timeoutValue: string | undefined;
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
		if (parseFlags && value === "--timeout") {
			const nextValue = args[index + 1];
			if (!nextValue || nextValue.startsWith("--")) {
				valid = false;
				break;
			}
			timeoutValue = nextValue;
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
		timeoutSeconds: parseTimeoutSeconds(timeoutValue),
	};
}

function parseTimeoutSeconds(value: string | undefined): number | undefined {
	if (value === undefined || value === "") {
		return undefined;
	}
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		console.error(`Invalid timeout: ${value}`);
		process.exit(1);
	}
	return parsed;
}

async function requestAgentResponse(params: {
	message: string;
	port: number;
	senderAgentId: string;
	target: string;
	timeoutSeconds?: number;
}): Promise<string> {
	return requestControlMessage({
		closeBeforeResponseMessage: "agent ask connection closed before response",
		errorFallback: "agent ask failed",
		errorType: "ask_error",
		port: params.port,
		request: {
			type: "ask",
			fromAgentId: params.senderAgentId,
			to: params.target,
			message: params.message,
		},
		responseType: "ask_response",
		timeout:
			params.timeoutSeconds === undefined
				? undefined
				: {
						message: `agent ask timed out after ${params.timeoutSeconds}s`,
						ms: params.timeoutSeconds * 1000,
					},
		toResult: (message) =>
			typeof message.text === "string" ? message.text : "",
	});
}

function resolveSenderAgent(
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
