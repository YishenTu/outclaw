import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	type BrowserAgentActiveSessionChangedEvent,
	type BrowserAgentsInvalidatedEvent,
	type BrowserChatCodingLinksChangedEvent,
	type BrowserSidebarInvalidatedEvent,
	type BrowserTerminalTarget,
	type CodingSessionStreamEvent,
	extractError,
	parseMessage,
	serialize,
} from "../../common/protocol.ts";
import type { AgentRuntime } from "../application/create-agent-runtime.ts";
import type { BrowserTerminalManager } from "../browser/terminal/manager.ts";
import type { WsClient } from "../transport/client-hub.ts";
import type { AgentRuntimeRegistry } from "./agent-runtime-registry.ts";
import type { ClientAgentBinding } from "./client-agent-binding.ts";

interface SupervisorControllerOptions {
	bindings: ClientAgentBinding;
	emitAgentEvents?: boolean;
	linkChatCodingSession?: (
		event: BrowserChatCodingLinksChangedEvent,
	) => Promise<void> | void;
	rememberBrowserClientAgentId?: (clientId: string, agentId: string) => void;
	rememberInteractiveAgentId?: (agentId: string) => void;
	registry: AgentRuntimeRegistry;
	resolveTerminalCwd?: (target: BrowserTerminalTarget) => {
		cwd?: string;
		error?: string;
	};
	terminalManager?: Pick<
		BrowserTerminalManager,
		"attach" | "close" | "create" | "detachClient" | "input" | "list" | "resize"
	>;
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
	cols?: number;
	cwd?: string;
	data?: string;
	fromAgentId?: string;
	jobName?: string;
	message?: string;
	name?: string;
	prompt?: string;
	rows?: number;
	scopeId?: string;
	target?: unknown;
	terminalId?: string;
	to?: string;
	type?: string;
}

export class SupervisorController {
	private readonly activeAskEdges = new Map<string, Map<string, number>>();

	constructor(private readonly options: SupervisorControllerOptions) {}

	broadcastBrowserSidebarInvalidated(event: BrowserSidebarInvalidatedEvent) {
		for (const client of this.options.bindings.listBoundClientsByTypes([
			"browser",
		])) {
			client.send(serialize(event));
		}
	}

	broadcastBrowserAgentsInvalidated(event: BrowserAgentsInvalidatedEvent) {
		for (const client of this.options.bindings.listBoundClientsByTypes([
			"browser",
		])) {
			client.send(serialize(event));
		}
	}

	broadcastBrowserAgentActiveSessionChanged(
		event: BrowserAgentActiveSessionChangedEvent,
	) {
		for (const client of this.options.bindings.listBoundClientsByTypes([
			"browser",
		])) {
			client.send(serialize(event));
		}
	}

	broadcastBrowserChatCodingLinksChanged(
		event: BrowserChatCodingLinksChangedEvent,
	) {
		for (const client of this.options.bindings.listBoundClientsByTypes([
			"browser",
		])) {
			client.send(serialize(event));
		}
	}

	broadcastCodingSessionEvent(event: CodingSessionStreamEvent) {
		for (const client of this.options.bindings.listBoundClientsByTypes([
			"browser",
		])) {
			client.send(serialize(event));
		}
	}

	handleClose = (ws: WsClient) => {
		this.options.terminalManager?.detachClient(ws);
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

		const data = this.tryParseMessage(message);
		if (this.handleTerminalMessage(ws, data)) {
			return;
		}

		const runtime = this.options.bindings.getCurrentRuntime(ws);
		if (!runtime) {
			this.sendError(ws, "No agent runtime is bound to this client");
			return;
		}

		if (data?.type === "command" && typeof data.command === "string") {
			if (this.handleAgentCommand(ws, data.command, runtime)) {
				return;
			}
		}

		runtime.handleMessage(ws, message);
	};

	private handleTerminalMessage(
		ws: WsClient,
		data: IncomingMessage | undefined,
	): boolean {
		if (!data || !isTerminalMessageType(data.type)) {
			return false;
		}
		if (!this.options.terminalManager) {
			this.sendTerminalError(ws, "Browser terminal runtime is not configured");
			return true;
		}
		if (ws.data.clientType !== "browser") {
			this.sendTerminalError(
				ws,
				"Browser terminals are only available to browser clients",
			);
			return true;
		}
		const ownerId = ws.data.cookieClientId;
		if (!ownerId) {
			this.sendTerminalError(ws, "Browser terminal owner is not available");
			return true;
		}

		if (data.type === "terminal_list") {
			ws.send(
				serialize({
					type: "terminal_sessions",
					terminals: this.options.terminalManager.list(ownerId),
				}),
			);
			return true;
		}

		if (data.type === "terminal_create") {
			if (!isTerminalCreateMessage(data)) {
				this.sendTerminalError(ws, "Invalid terminal create request");
				return true;
			}
			if (!this.options.resolveTerminalCwd) {
				this.sendTerminalError(
					ws,
					"Browser terminal workspace resolver is not configured",
					data.terminalId,
				);
				return true;
			}
			const target = this.options.resolveTerminalCwd(data.target);
			if (!target.cwd) {
				this.sendTerminalError(
					ws,
					target.error ?? "Terminal workspace is not available",
					data.terminalId,
				);
				return true;
			}
			this.options.terminalManager.create({
				client: ws,
				...(data.cols !== undefined ? { cols: data.cols } : {}),
				cwd: target.cwd,
				name: data.name,
				...(data.rows !== undefined ? { rows: data.rows } : {}),
				scopeId: data.scopeId,
				target: data.target,
				terminalId: data.terminalId,
			});
			return true;
		}

		if (data.type === "terminal_attach") {
			if (!isTerminalAttachMessage(data)) {
				this.sendTerminalError(ws, "Invalid terminal attach request");
				return true;
			}
			this.options.terminalManager.attach({
				client: ws,
				...(data.cols !== undefined ? { cols: data.cols } : {}),
				...(data.rows !== undefined ? { rows: data.rows } : {}),
				terminalId: data.terminalId,
			});
			return true;
		}

		if (data.type === "terminal_input") {
			if (
				typeof data.terminalId !== "string" ||
				typeof data.data !== "string"
			) {
				this.sendTerminalError(ws, "Invalid terminal input request");
				return true;
			}
			this.options.terminalManager.input(ownerId, data.terminalId, data.data);
			return true;
		}

		if (data.type === "terminal_resize") {
			if (
				typeof data.terminalId !== "string" ||
				typeof data.cols !== "number" ||
				typeof data.rows !== "number"
			) {
				this.sendTerminalError(ws, "Invalid terminal resize request");
				return true;
			}
			this.options.terminalManager.resize(
				ownerId,
				data.terminalId,
				data.cols,
				data.rows,
			);
			return true;
		}

		if (data.type === "terminal_close" && typeof data.terminalId === "string") {
			this.options.terminalManager.close(ownerId, data.terminalId);
			return true;
		}

		this.sendTerminalError(ws, "Invalid terminal request");
		return true;
	}

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

		if (data?.type === "cron_run") {
			this.handleCronRunMessage(ws, data);
			return;
		}

		if (data?.type === "code_prompt") {
			await this.handleCodePromptMessage(ws, data);
			return;
		}

		if (data?.type === "send") {
			this.handleSendMessage(ws, data);
			return;
		}

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

		const askCycle = this.findAskCycle(sender, target);
		if (askCycle) {
			this.sendAskError(
				ws,
				`cannot ask ${target.name} because it would create a peer ask cycle (${askCycle.join(" -> ")}); answer the peer request directly in your current response`,
			);
			return;
		}

		this.addActiveAskEdge(sender.agentId, target.agentId);
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
		} finally {
			this.removeActiveAskEdge(sender.agentId, target.agentId);
		}
	}

	private handleSendMessage(ws: WsClient, data: IncomingMessage) {
		if (
			data.type !== "send" ||
			typeof data.fromAgentId !== "string" ||
			typeof data.to !== "string" ||
			typeof data.message !== "string"
		) {
			this.sendSendError(ws, "Invalid send request");
			return;
		}

		const sender = this.options.registry.getById(data.fromAgentId);
		if (!sender) {
			this.sendSendError(ws, "Unknown sender agent");
			return;
		}

		const target = this.options.registry.getByName(data.to);
		if (!target) {
			this.sendSendError(ws, `agent "${data.to}" not found`);
			return;
		}

		if (sender.agentId === target.agentId) {
			this.sendSendError(ws, "cannot send to self");
			return;
		}

		const accepted = target.sendFromAgent({
			fromAgentId: sender.agentId,
			fromAgentName: sender.name,
			message: data.message,
		});
		if (!accepted) {
			this.sendSendError(ws, "Runtime shutting down");
			return;
		}

		ws.send(
			serialize({
				type: "send_response",
			}),
		);
	}

	private handleCronRunMessage(ws: WsClient, data: IncomingMessage) {
		if (
			data.type !== "cron_run" ||
			typeof data.cwd !== "string" ||
			typeof data.jobName !== "string" ||
			data.jobName.trim() === ""
		) {
			this.sendCronRunError(ws, "Invalid cron run request");
			return;
		}

		const runtime = this.resolveRuntimeFromCwd(data.cwd);
		if (!runtime) {
			this.sendCronRunError(ws, "cannot resolve agent from cwd");
			return;
		}

		const result = runtime.runCronJob({
			jobName: data.jobName.trim(),
		});
		if (result.status === "accepted") {
			ws.send(
				serialize({
					type: "cron_run_response",
					jobName: result.jobName,
				}),
			);
			return;
		}

		if (result.status === "disabled") {
			this.sendCronRunError(ws, `Cron job is disabled: ${result.jobName}`);
			return;
		}

		if (result.status === "unavailable") {
			this.sendCronRunError(
				ws,
				`Cron is not configured for agent: ${runtime.name}`,
			);
			return;
		}

		this.sendCronRunError(ws, `Cron job not found: ${result.jobName}`);
	}

	private async handleCodePromptMessage(ws: WsClient, data: IncomingMessage) {
		if (
			data.type !== "code_prompt" ||
			typeof data.cwd !== "string" ||
			typeof data.prompt !== "string" ||
			data.prompt.trim() === ""
		) {
			this.sendCodePromptError(ws, "Invalid code prompt request");
			return;
		}

		const runtime = this.resolveRuntimeFromCwd(data.cwd);
		if (!runtime) {
			this.sendCodePromptError(ws, "cannot resolve agent from cwd");
			return;
		}

		const chatContext = this.resolveActiveChatCodingContext(runtime);
		const result = await runtime.coding.startPrompt({
			cwd: data.cwd,
			prompt: data.prompt,
			...(chatContext
				? { linkedChatSessionId: chatContext.chatSdkSessionId }
				: {}),
		});
		if (result.status === "rejected") {
			this.sendCodePromptError(ws, result.message);
			return;
		}

		ws.send(
			serialize({
				type: "code_prompt_response",
				providerId: result.providerId,
				sdkSessionId: result.sdkSessionId,
			}),
		);
		await this.recordControlChatCodingLink(chatContext, {
			providerId: result.providerId,
			sdkSessionId: result.sdkSessionId,
		});
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
		// Each connection is independent: switching one TUI/browser client does not
		// drag others to the same agent. Multi-browser, multi-user setups depend on
		// this. (Multiple clients can still co-view the same agent if they
		// independently bind there — that's "one session per agent, multiple agents
		// in parallel".)
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

	private sendSendError(ws: WsClient, message: string) {
		ws.send(
			serialize({
				type: "send_error",
				message,
			}),
		);
	}

	private sendCronRunError(ws: WsClient, message: string) {
		ws.send(
			serialize({
				type: "cron_run_error",
				message,
			}),
		);
	}

	private sendCodePromptError(ws: WsClient, message: string) {
		ws.send(
			serialize({
				type: "code_prompt_error",
				message,
			}),
		);
	}

	private sendTerminalError(
		ws: WsClient,
		message: string,
		terminalId?: string,
	) {
		ws.send(
			serialize({
				type: "terminal_error",
				message,
				...(terminalId ? { terminalId } : {}),
			}),
		);
	}

	private addActiveAskEdge(fromAgentId: string, toAgentId: string) {
		const targets =
			this.activeAskEdges.get(fromAgentId) ?? new Map<string, number>();
		targets.set(toAgentId, (targets.get(toAgentId) ?? 0) + 1);
		this.activeAskEdges.set(fromAgentId, targets);
	}

	private removeActiveAskEdge(fromAgentId: string, toAgentId: string) {
		const targets = this.activeAskEdges.get(fromAgentId);
		if (!targets) {
			return;
		}

		const count = targets.get(toAgentId) ?? 0;
		if (count > 1) {
			targets.set(toAgentId, count - 1);
			return;
		}

		targets.delete(toAgentId);
		if (targets.size === 0) {
			this.activeAskEdges.delete(fromAgentId);
		}
	}

	private findAskCycle(
		sender: AgentRuntime,
		target: AgentRuntime,
	): string[] | undefined {
		const path = this.findActiveAskPath(
			target.agentId,
			sender.agentId,
			new Set(),
		);
		if (!path) {
			return undefined;
		}

		return [...path, target.agentId].map(
			(agentId) => this.options.registry.getById(agentId)?.name ?? agentId,
		);
	}

	private findActiveAskPath(
		fromAgentId: string,
		toAgentId: string,
		visited: Set<string>,
	): string[] | undefined {
		if (fromAgentId === toAgentId) {
			return [fromAgentId];
		}
		if (visited.has(fromAgentId)) {
			return undefined;
		}
		visited.add(fromAgentId);

		const nextAgentIds = this.activeAskEdges.get(fromAgentId)?.keys() ?? [];
		for (const nextAgentId of nextAgentIds) {
			const path = this.findActiveAskPath(nextAgentId, toAgentId, visited);
			if (path) {
				return [fromAgentId, ...path];
			}
		}

		return undefined;
	}

	private resolveRuntimeFromCwd(cwd: string): AgentRuntime | undefined {
		try {
			const agentIdPath = join(cwd, ".agent-id");
			if (!existsSync(agentIdPath)) {
				return undefined;
			}
			const agentId = readFileSync(agentIdPath, "utf-8").trim();
			if (!agentId) {
				return undefined;
			}
			return this.options.registry.getById(agentId);
		} catch {
			return undefined;
		}
	}

	private resolveActiveChatCodingContext(runtime: AgentRuntime):
		| {
				chatAgentId: string;
				chatProviderId: string;
				chatSdkSessionId: string;
		  }
		| undefined {
		const activeSessionId = runtime.getActiveSessionId();
		if (!activeSessionId) {
			return undefined;
		}
		return {
			chatAgentId: runtime.agentId,
			chatProviderId: runtime.providerId,
			chatSdkSessionId: activeSessionId,
		};
	}

	private async recordControlChatCodingLink(
		chatContext:
			| {
					chatAgentId: string;
					chatProviderId: string;
					chatSdkSessionId: string;
			  }
			| undefined,
		codingSession: { providerId: string; sdkSessionId: string },
	) {
		if (!chatContext || !this.options.linkChatCodingSession) {
			return;
		}
		const event: BrowserChatCodingLinksChangedEvent = {
			type: "browser_chat_coding_links_changed",
			...chatContext,
			codingProviderId: codingSession.providerId,
			codingSdkSessionId: codingSession.sdkSessionId,
		};
		try {
			await this.options.linkChatCodingSession(event);
		} catch (error) {
			console.warn("Failed to link control coding session", error);
			return;
		}
		this.broadcastBrowserChatCodingLinksChanged(event);
	}

	private rememberAgentSelection(ws: WsClient, agentId: string) {
		if (ws.data.clientType === "browser") {
			if (
				typeof ws.data.cookieClientId === "string" &&
				this.options.rememberBrowserClientAgentId
			) {
				this.options.rememberBrowserClientAgentId(
					ws.data.cookieClientId,
					agentId,
				);
			}
			return;
		}

		if (ws.data.clientType === "tui") {
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
		// Only TUI uses the global last-interactive-agent slot. Browser persistence
		// is per-cookie and goes through rememberAgentSelection on explicit switch.
		if (ws.data.clientType !== "tui") {
			return;
		}
		this.options.rememberInteractiveAgentId?.(agentId);
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

function isTerminalMessageType(type: string | undefined): boolean {
	return (
		type === "terminal_list" ||
		type === "terminal_create" ||
		type === "terminal_attach" ||
		type === "terminal_input" ||
		type === "terminal_resize" ||
		type === "terminal_close"
	);
}

function isTerminalCreateMessage(
	data: IncomingMessage,
): data is IncomingMessage & {
	name: string;
	scopeId: string;
	target: BrowserTerminalTarget;
	terminalId: string;
} {
	return (
		data.type === "terminal_create" &&
		typeof data.terminalId === "string" &&
		data.terminalId.trim() !== "" &&
		typeof data.scopeId === "string" &&
		data.scopeId.trim() !== "" &&
		typeof data.name === "string" &&
		data.name.trim() !== "" &&
		isBrowserTerminalTarget(data.target)
	);
}

function isTerminalAttachMessage(
	data: IncomingMessage,
): data is IncomingMessage & { terminalId: string } {
	return (
		data.type === "terminal_attach" &&
		typeof data.terminalId === "string" &&
		data.terminalId.trim() !== ""
	);
}

function isBrowserTerminalTarget(
	value: unknown,
): value is BrowserTerminalTarget {
	if (!value || typeof value !== "object") {
		return false;
	}
	const record = value as Record<string, unknown>;
	if (record.kind === "agent") {
		return typeof record.agentId === "string" && record.agentId.trim() !== "";
	}
	if (record.kind === "coding") {
		return (
			typeof record.repositoryId === "string" &&
			record.repositoryId.trim() !== "" &&
			(record.providerId === undefined ||
				typeof record.providerId === "string") &&
			(record.sdkSessionId === undefined ||
				typeof record.sdkSessionId === "string")
		);
	}
	return false;
}
