import {
	type BrowserSidebarInvalidatedEvent,
	extractError,
	parseMessage,
	serialize,
} from "../../common/protocol.ts";
import type { AgentRuntime } from "../application/create-agent-runtime.ts";
import type { WsClient } from "../transport/client-hub.ts";
import type { AgentRuntimeRegistry } from "./agent-runtime-registry.ts";
import type { ClientAgentBinding } from "./client-agent-binding.ts";

interface SupervisorControllerOptions {
	bindings: ClientAgentBinding;
	emitAgentEvents?: boolean;
	rememberInteractiveAgentId?: (agentId: string) => void;
	registry: AgentRuntimeRegistry;
	telegramRouting?: {
		rememberAgentId(
			botId: string,
			telegramUserId: number,
			agentId: string,
		): void;
	};
}

interface IncomingMessage {
	command?: string;
	fromAgentId?: string;
	message?: string;
	to?: string;
	type?: string;
}

export class SupervisorController {
	constructor(private readonly options: SupervisorControllerOptions) {}

	broadcastBrowserSidebarInvalidated(event: BrowserSidebarInvalidatedEvent) {
		for (const client of this.options.bindings.listBoundClientsByTypes([
			"browser",
		])) {
			client.send(serialize(event));
		}
	}

	handleClose = (ws: WsClient) => {
		if (ws.data.clientType === "control") {
			return;
		}
		this.options.bindings.unbind(ws)?.handleClose(ws);
	};

	handleMessage = (ws: WsClient, message: string | Buffer) => {
		if (ws.data.clientType === "control") {
			void this.handleControlMessage(ws, message);
			return;
		}

		const runtime = this.options.bindings.getCurrentRuntime(ws);
		if (!runtime) {
			this.sendError(ws, "No agent runtime is bound to this client");
			return;
		}

		const data = this.tryParseMessage(message);
		if (data?.type === "command" && typeof data.command === "string") {
			if (this.handleAgentCommand(ws, data.command, runtime)) {
				return;
			}
		}

		runtime.handleMessage(ws, message);
	};

	handleOpen = (ws: WsClient) => {
		if (ws.data.clientType === "control") {
			return;
		}

		const runtime = this.options.bindings.bindInitial(ws);
		if (!runtime) {
			const requestedAgentName = ws.data.requestedAgentName;
			this.sendError(
				ws,
				requestedAgentName
					? `Unknown agent: ${requestedAgentName}`
					: "No agent runtimes available",
			);
			ws.close();
			return;
		}

		if (this.options.emitAgentEvents !== false) {
			this.sendAgentSwitched(ws, runtime);
		}
		this.rememberInteractiveAgentId(ws, runtime.agentId);
		runtime.handleOpen(ws);
	};

	private async handleControlMessage(ws: WsClient, message: string | Buffer) {
		const data = this.tryParseMessage(message);
		if (
			data?.type !== "ask" ||
			typeof data.fromAgentId !== "string" ||
			typeof data.to !== "string" ||
			typeof data.message !== "string"
		) {
			this.sendAskError(ws, "Invalid ask request");
			return;
		}

		const sender = this.options.registry.getById(data.fromAgentId);
		if (!sender) {
			this.sendAskError(ws, "Unknown sender agent");
			return;
		}

		const target = this.options.registry.getByName(data.to);
		if (!target) {
			this.sendAskError(ws, `agent "${data.to}" not found`);
			return;
		}

		if (sender.agentId === target.agentId) {
			this.sendAskError(ws, "cannot ask self");
			return;
		}

		try {
			const text = await target.askFromAgent({
				fromAgentId: sender.agentId,
				fromAgentName: sender.name,
				message: data.message,
			});
			ws.send(
				serialize({
					type: "ask_response",
					text,
				}),
			);
		} catch (error) {
			this.sendAskError(ws, extractError(error));
		}
	}

	private handleAgentCommand(
		ws: WsClient,
		command: string,
		currentRuntime: AgentRuntime,
	): boolean {
		const trimmed = command.trim();
		if (trimmed === "/agent") {
			if (this.options.emitAgentEvents === false) {
				return false;
			}
			this.sendAgentMenu(ws, currentRuntime);
			return true;
		}
		if (!trimmed.startsWith("/agent ")) {
			return false;
		}

		const selector = trimmed.slice("/agent ".length).trim();
		if (!selector) {
			if (this.options.emitAgentEvents === false) {
				return false;
			}
			this.sendAgentMenu(ws, currentRuntime);
			return true;
		}

		const switched = this.options.bindings.switchToName(ws, selector);
		if (!switched) {
			this.sendError(ws, `Unknown agent: ${selector}`);
			return true;
		}

		if (switched.previous?.agentId === switched.next.agentId) {
			if (this.options.emitAgentEvents !== false) {
				this.sendAgentSwitched(ws, switched.next);
			}
			this.rememberAgentSelection(ws, switched.next.agentId);
			return true;
		}

		switched.previous?.handleClose(ws);
		if (this.options.emitAgentEvents !== false) {
			this.sendAgentSwitched(ws, switched.next);
		}
		this.rememberAgentSelection(ws, switched.next.agentId);
		switched.next.handleOpen(ws);
		this.syncInteractiveClients(ws, switched.next);
		return true;
	}

	private sendAgentMenu(ws: WsClient, currentRuntime: AgentRuntime) {
		ws.send(
			serialize({
				type: "agent_menu",
				activeAgentId: currentRuntime.agentId,
				activeAgentName: currentRuntime.name,
				agents: this.options.bindings
					.listAvailableRuntimes(ws)
					.map((runtime) => ({
						agentId: runtime.agentId,
						name: runtime.name,
					})),
			}),
		);
	}

	private sendAgentSwitched(ws: WsClient, runtime: AgentRuntime) {
		ws.send(
			serialize({
				type: "agent_switched",
				agentId: runtime.agentId,
				name: runtime.name,
			}),
		);
	}

	private sendError(ws: WsClient, message: string) {
		ws.send(
			serialize({
				type: "error",
				message,
			}),
		);
	}

	private sendAskError(ws: WsClient, message: string) {
		ws.send(
			serialize({
				type: "ask_error",
				message,
			}),
		);
	}

	private rememberAgentSelection(ws: WsClient, agentId: string) {
		if (ws.data.clientType === "tui" || ws.data.clientType === "browser") {
			this.options.rememberInteractiveAgentId?.(agentId);
			return;
		}

		if (
			ws.data.clientType === "telegram" &&
			this.options.telegramRouting &&
			typeof ws.data.telegramBotId === "string" &&
			ws.data.telegramUserId !== undefined
		) {
			this.options.telegramRouting.rememberAgentId(
				ws.data.telegramBotId,
				ws.data.telegramUserId,
				agentId,
			);
		}
	}

	private rememberInteractiveAgentId(ws: WsClient, agentId: string) {
		if (ws.data.clientType !== "tui" && ws.data.clientType !== "browser") {
			return;
		}
		this.options.rememberInteractiveAgentId?.(agentId);
	}

	private syncInteractiveClients(ws: WsClient, runtime: AgentRuntime) {
		for (const client of this.options.bindings.listBoundClientsByTypes(
			["tui", "browser"],
			ws,
		)) {
			const switched = this.options.bindings.switchToName(client, runtime.name);
			if (!switched || switched.previous?.agentId === switched.next.agentId) {
				continue;
			}

			switched.previous?.handleClose(client);
			if (this.options.emitAgentEvents !== false) {
				this.sendAgentSwitched(client, switched.next);
			}
			switched.next.handleOpen(client);
		}
	}

	private tryParseMessage(
		message: string | Buffer,
	): IncomingMessage | undefined {
		try {
			return parseMessage(message) as IncomingMessage;
		} catch (error) {
			console.error(
				`Failed to parse supervisor message: ${extractError(error)}`,
			);
			return undefined;
		}
	}
}
