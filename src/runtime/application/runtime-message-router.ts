import type { ImageRef, ReplyContext } from "../../common/protocol.ts";
import { extractError, parseMessage } from "../../common/protocol.ts";
import type { WsClient } from "../transport/client-hub.ts";
import type { PromptExecution } from "./prompt-dispatcher.ts";
import type { RuntimeClientGateway } from "./runtime-client-gateway.ts";
import type { RuntimeControlPlane } from "./runtime-control-plane.ts";
import type { RuntimeExecutionCoordinator } from "./runtime-execution-coordinator.ts";

interface IncomingMessage {
	command?: string;
	images?: ImageRef[];
	prompt?: string;
	replyContext?: ReplyContext;
	source?: string;
	telegramChatId?: number;
	type?: string;
}

interface RuntimeMessageRouterOptions {
	clients: Pick<RuntimeClientGateway, "requestSkills" | "send">;
	controlPlane: Pick<RuntimeControlPlane, "handleCommand">;
	execution: Pick<
		RuntimeExecutionCoordinator,
		"enqueuePrompt" | "isShuttingDown"
	>;
}

export class RuntimeMessageRouter {
	constructor(private readonly options: RuntimeMessageRouterOptions) {}

	handleMessage(ws: WsClient, message: string | Buffer) {
		if (this.options.execution.isShuttingDown) {
			this.options.clients.send(ws, {
				type: "status",
				message: "Runtime shutting down",
			});
			return;
		}

		let data: IncomingMessage;
		try {
			data = parseMessage(message) as IncomingMessage;
		} catch (err) {
			this.options.clients.send(ws, {
				type: "error",
				message: extractError(err),
			});
			return;
		}

		if (data.type === "request_skills") {
			this.options.clients.requestSkills(ws);
			return;
		}

		if (data.type === "command" && data.command) {
			this.options.controlPlane.handleCommand(ws, data.command);
			return;
		}

		const promptExecution = toPromptExecution(data, ws);
		if (!promptExecution) {
			return;
		}

		this.options.execution.enqueuePrompt(promptExecution);
	}
}

function toPromptExecution(
	data: IncomingMessage,
	ws: WsClient,
): PromptExecution | undefined {
	if (data.type !== "prompt") {
		return undefined;
	}

	const prompt = data.prompt ?? "";
	const hasPrompt = prompt !== "";
	const hasImages = (data.images?.length ?? 0) > 0;
	if (!hasPrompt && !hasImages) {
		return undefined;
	}

	return {
		sender: ws,
		prompt,
		replyContext: data.replyContext,
		source:
			ws.data.clientType === "browser"
				? "browser"
				: ws.data.clientType === "telegram" || data.source === "telegram"
					? "telegram"
					: "tui",
		images: data.images,
		telegramBotId:
			ws.data.clientType === "telegram" || data.source === "telegram"
				? ws.data.telegramBotId
				: undefined,
		telegramChatId: data.telegramChatId,
	};
}
