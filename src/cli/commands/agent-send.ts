import { loadGlobalConfig } from "../../runtime/config/index.ts";
import { requestControlMessage } from "../support/control-client.ts";
import { formatAgentSendUsage, printAgentSendUsage } from "../support/usage.ts";
import { parseAgentMessageArgs, resolveSenderAgent } from "./agent-message.ts";

export async function sendAgentCommand(homeDir: string, argv: string[]) {
	const args = argv.slice(4);
	if (args.some((arg) => arg === "--help" || arg === "-h")) {
		printAgentSendUsage();
		process.exit(0);
	}
	const parsed = parseAgentMessageArgs(args);
	const target = parsed.target;
	const message = parsed.message;
	if (!target || !message) {
		console.error(formatAgentSendUsage());
		process.exit(1);
	}

	const sender = resolveSenderAgent(homeDir, process.cwd());
	if (!sender) {
		console.error("cannot resolve sender agent from cwd");
		process.exit(1);
	}

	const config = loadGlobalConfig(homeDir);
	try {
		await requestAgentSend({
			message,
			port: config.port,
			senderAgentId: sender.agentId,
			target,
		});
		process.exit(0);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(message);
		process.exit(1);
	}
}

async function requestAgentSend(params: {
	message: string;
	port: number;
	senderAgentId: string;
	target: string;
}): Promise<void> {
	return requestControlMessage({
		closeBeforeResponseMessage: "agent send connection closed before response",
		errorFallback: "agent send failed",
		errorType: "send_error",
		port: params.port,
		request: {
			type: "send",
			fromAgentId: params.senderAgentId,
			to: params.target,
			message: params.message,
		},
		responseType: "send_response",
		toResult: () => undefined,
	});
}
