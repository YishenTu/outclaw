import type { AgentRuntime } from "../application/create-agent-runtime.ts";
import type { WsClient } from "../transport/client-hub.ts";
import type { AgentRuntimeRegistry } from "./agent-runtime-registry.ts";

interface TelegramRouting {
	getAgentId(botId: string, telegramUserId: number): string | undefined;
	listAgentIds(botId: string, telegramUserId: number): string[];
}

export class ClientAgentBinding {
	private readonly bindings = new Map<WsClient, string>();

	constructor(
		private readonly registry: AgentRuntimeRegistry,
		private readonly getDefaultAgentId?: () => string | undefined,
		private readonly telegramRouting?: TelegramRouting,
	) {}

	bindInitial(ws: WsClient) {
		const requestedAgentName = ws.data.requestedAgentName?.trim();
		const runtime = requestedAgentName
			? this.findAvailableRuntimeByName(ws, requestedAgentName)
			: this.resolveDefaultRuntime(ws);
		if (!runtime) {
			return undefined;
		}

		this.bindings.set(ws, runtime.agentId);
		return runtime;
	}

	getCurrentAgentId(ws: WsClient): string | undefined {
		return this.bindings.get(ws);
	}

	getCurrentRuntime(ws: WsClient) {
		const agentId = this.bindings.get(ws);
		return agentId ? this.registry.getById(agentId) : undefined;
	}

	listAvailableRuntimes(ws: WsClient) {
		if (ws.data.clientType !== "telegram") {
			return this.registry.list();
		}

		const botId = ws.data.telegramBotId;
		const telegramUserId = ws.data.telegramUserId;
		if (
			!this.telegramRouting ||
			typeof botId !== "string" ||
			telegramUserId === undefined
		) {
			return this.registry.list();
		}

		return this.telegramRouting
			.listAgentIds(botId, telegramUserId)
			.map((agentId) => this.registry.getById(agentId))
			.filter((runtime): runtime is AgentRuntime => runtime !== undefined)
			.sort((left, right) => left.name.localeCompare(right.name));
	}

	isBoundToAgentId(ws: WsClient, agentId: string): boolean {
		return this.bindings.get(ws) === agentId;
	}

	switchToName(ws: WsClient, name: string) {
		const next = this.findAvailableRuntimeByName(ws, name);
		if (!next) {
			return undefined;
		}

		const previous = this.getCurrentRuntime(ws);
		this.bindings.set(ws, next.agentId);
		return {
			next,
			previous,
		};
	}

	unbind(ws: WsClient) {
		const runtime = this.getCurrentRuntime(ws);
		this.bindings.delete(ws);
		return runtime;
	}

	private resolveDefaultRuntime(ws: WsClient) {
		if (ws.data.clientType === "telegram") {
			const available = this.listAvailableRuntimes(ws);
			if (available.length === 0) {
				return undefined;
			}

			const botId = ws.data.telegramBotId;
			const telegramUserId = ws.data.telegramUserId;
			if (
				this.telegramRouting &&
				typeof botId === "string" &&
				telegramUserId !== undefined
			) {
				const routedAgentId = this.telegramRouting.getAgentId(
					botId,
					telegramUserId,
				);
				if (routedAgentId) {
					const routedRuntime = available.find(
						(runtime) => runtime.agentId === routedAgentId,
					);
					if (routedRuntime) {
						return routedRuntime;
					}
				}
			}

			return available[0];
		}

		if (ws.data.clientType === "tui" && this.getDefaultAgentId) {
			const rememberedAgentId = this.getDefaultAgentId();
			if (rememberedAgentId) {
				return (
					this.registry.getById(rememberedAgentId) ?? this.registry.getDefault()
				);
			}
		}
		return this.registry.getDefault();
	}

	private findAvailableRuntimeByName(ws: WsClient, name: string) {
		return this.listAvailableRuntimes(ws).find(
			(runtime) => runtime.name === name,
		);
	}
}
