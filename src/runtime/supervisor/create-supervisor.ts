import type { RuntimeClientType } from "../../common/protocol.ts";
import type { AgentRuntime } from "../application/create-agent-runtime.ts";
import { AgentRuntimeRegistry } from "./agent-runtime-registry.ts";
import { ClientAgentBinding } from "./client-agent-binding.ts";
import { SupervisorController } from "./supervisor-controller.ts";

interface TelegramRoutingOptions {
	getAgentId(botId: string, telegramUserId: number): string | undefined;
	listAgentIds(botId: string, telegramUserId: number): string[];
	rememberAgentId(botId: string, telegramUserId: number, agentId: string): void;
}

interface CreateSupervisorOptions {
	agents: AgentRuntime[];
	emitAgentEvents?: boolean;
	getDefaultAgentId?: () => string | undefined;
	port: number;
	rememberTuiAgentId?: (agentId: string) => void;
	telegramRouting?: TelegramRoutingOptions;
}

export function createSupervisor(options: CreateSupervisorOptions) {
	const registry = new AgentRuntimeRegistry(options.agents);
	const bindings = new ClientAgentBinding(
		registry,
		options.getDefaultAgentId,
		options.telegramRouting,
	);
	const controller = new SupervisorController({
		bindings,
		emitAgentEvents: options.emitAgentEvents,
		rememberTuiAgentId: options.rememberTuiAgentId,
		registry,
		telegramRouting: options.telegramRouting,
	});

	const server = Bun.serve<{
		clientType: RuntimeClientType;
		requestedAgentName?: string;
		telegramBotId?: string;
		telegramUserId?: number;
	}>({
		port: options.port,
		fetch(req, server) {
			const url = new URL(req.url);
			const clientType = resolveClientType(url);
			const requestedAgentName = url.searchParams.get("agent") ?? undefined;
			const telegramBotId = url.searchParams.get("telegramBotId") ?? undefined;
			const telegramUserId = resolveTelegramUserId(url);
			if (
				server.upgrade(req, {
					data: {
						clientType,
						requestedAgentName,
						telegramBotId,
						telegramUserId,
					},
				})
			) {
				return;
			}
			return new Response("outclaw runtime", { status: 200 });
		},
		websocket: {
			close: controller.handleClose,
			message: controller.handleMessage,
			open: controller.handleOpen,
		},
	});

	let stopPromise: Promise<void> | undefined;

	return {
		port: server.port as number,
		stop() {
			if (!stopPromise) {
				stopPromise = (async () => {
					await registry.stopAll();
					server.stop();
				})();
			}
			return stopPromise;
		},
	};
}

function resolveClientType(url: URL): RuntimeClientType {
	const client = url.searchParams.get("client");
	if (client === "telegram" || client === "control") {
		return client;
	}
	return "tui";
}

function resolveTelegramUserId(url: URL): number | undefined {
	const value = url.searchParams.get("telegramUserId");
	if (!value) {
		return undefined;
	}

	const parsed = Number(value);
	return Number.isInteger(parsed) ? parsed : undefined;
}
