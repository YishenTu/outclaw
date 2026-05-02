import type { RuntimeClientType } from "../../common/protocol.ts";
import type { AgentRuntime } from "../application/create-agent-runtime.ts";
import { createBrowserSidebarWatcher } from "../browser/sidebar/watcher.ts";
import { TerminalRelay } from "../browser/terminal/relay.ts";
import { AgentRuntimeRegistry } from "./agent-runtime-registry.ts";
import {
	type BrowserApi,
	handleBrowserApiRequest,
} from "./browser-api-router.ts";
import { type BrowserApp, serveBrowserApp } from "./browser-app.ts";
import { ClientAgentBinding } from "./client-agent-binding.ts";
import { SupervisorController } from "./supervisor-controller.ts";
import { handleTerminalGatewayRequest } from "./terminal-gateway.ts";
import {
	isRuntimeSocketPath,
	isWebSocketUpgradeRequest,
	resolveRuntimeClientType,
	resolveTelegramUserId,
} from "./websocket-routing.ts";

interface SupervisorSocketData {
	clientType: RuntimeClientType;
	socketType: "runtime" | "terminal";
	requestedAgentName?: string;
	terminalCwd?: string;
	telegramBotId?: string;
	telegramUserId?: number;
}

type SupervisorServeOptions = Parameters<
	typeof Bun.serve<SupervisorSocketData>
>[0];

const EPHEMERAL_PORT_MIN = 49152;
const EPHEMERAL_PORT_RANGE = 16384;
let nextEphemeralPort =
	EPHEMERAL_PORT_MIN + Math.floor(Math.random() * EPHEMERAL_PORT_RANGE);

interface TelegramRoutingOptions {
	getAgentId(botId: string, telegramUserId: number): string | undefined;
	listAgentIds(botId: string, telegramUserId: number): string[];
	rememberAgentId(botId: string, telegramUserId: number, agentId: string): void;
}

interface CreateSupervisorOptions {
	agents: AgentRuntime[];
	browserApp?: BrowserApp;
	browserApi?: BrowserApi;
	browserWatch?: {
		agents: Array<{
			agentId: string;
			rootDir: string;
		}>;
		createWatcher?: typeof createBrowserSidebarWatcher;
		gitRoot: string;
	};
	emitAgentEvents?: boolean;
	getDefaultAgentId?: () => string | undefined;
	hostname?: string;
	port: number;
	rememberInteractiveAgentId?: (agentId: string) => void;
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
		rememberInteractiveAgentId: options.rememberInteractiveAgentId,
		registry,
		telegramRouting: options.telegramRouting,
	});
	const browserSidebarWatcher = options.browserWatch
		? (options.browserWatch.createWatcher ?? createBrowserSidebarWatcher)({
				agents: options.browserWatch.agents,
				gitRoot: options.browserWatch.gitRoot,
				onInvalidate: (event) =>
					controller.broadcastBrowserSidebarInvalidated(event),
			})
		: undefined;
	const terminalRelay = new TerminalRelay();

	const server = createSupervisorServer({
		hostname: options.hostname,
		port: options.port,
		async fetch(req, server) {
			const url = new URL(req.url);
			if (url.pathname.startsWith("/api/")) {
				return await handleBrowserApiRequest(req, url, options.browserApi);
			}

			if (url.pathname === "/terminal") {
				return handleTerminalGatewayRequest(
					req,
					url,
					server,
					options.browserApi,
				);
			}

			if (isRuntimeSocketPath(url.pathname)) {
				if (!isWebSocketUpgradeRequest(req)) {
					if (url.pathname === "/") {
						const browserAppResponse = serveBrowserApp(
							req.method,
							url.pathname,
							options.browserApp,
						);
						if (browserAppResponse) {
							return browserAppResponse;
						}
					}
					return new Response("outclaw runtime", { status: 200 });
				}
			} else {
				const browserAppResponse = serveBrowserApp(
					req.method,
					url.pathname,
					options.browserApp,
				);
				if (browserAppResponse) {
					return browserAppResponse;
				}
				return new Response("outclaw runtime", { status: 200 });
			}

			const clientType = resolveRuntimeClientType(url);
			const requestedAgentName = url.searchParams.get("agent") ?? undefined;
			const telegramBotId = url.searchParams.get("telegramBotId") ?? undefined;
			const telegramUserId = resolveTelegramUserId(url);
			if (
				server.upgrade(req, {
					data: {
						clientType,
						socketType: "runtime",
						requestedAgentName,
						telegramBotId,
						telegramUserId,
					},
				})
			) {
				return;
			}
			return new Response("WebSocket upgrade failed", { status: 400 });
		},
		websocket: {
			close(ws) {
				if (ws.data.socketType === "terminal") {
					terminalRelay.handleClose(ws);
					return;
				}
				controller.handleClose(ws);
			},
			message(ws, message) {
				if (ws.data.socketType === "terminal") {
					terminalRelay.handleMessage(ws, message);
					return;
				}
				controller.handleMessage(ws, message);
			},
			open(ws) {
				if (ws.data.socketType === "terminal") {
					terminalRelay.handleOpen(ws);
					return;
				}
				controller.handleOpen(ws);
			},
		},
	});
	browserSidebarWatcher?.start();

	let stopPromise: Promise<void> | undefined;

	return {
		port: server.port as number,
		stop() {
			if (!stopPromise) {
				stopPromise = (async () => {
					browserSidebarWatcher?.stop();
					await registry.stopAll();
					server.stop();
				})();
			}
			return stopPromise;
		},
	};
}

function createSupervisorServer(options: SupervisorServeOptions) {
	if (options.port !== 0) {
		return Bun.serve<SupervisorSocketData>(options);
	}

	let lastError: unknown;
	for (let attempt = 0; attempt < 100; attempt += 1) {
		try {
			return Bun.serve<SupervisorSocketData>({
				...options,
				port: reserveEphemeralPort(),
			});
		} catch (error) {
			if (!isListenError(error)) {
				throw error;
			}
			lastError = error;
		}
	}

	throw lastError;
}

function reserveEphemeralPort(): number {
	const port = nextEphemeralPort;
	nextEphemeralPort += 1;
	if (nextEphemeralPort >= EPHEMERAL_PORT_MIN + EPHEMERAL_PORT_RANGE) {
		nextEphemeralPort = EPHEMERAL_PORT_MIN;
	}
	return port;
}

function isListenError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { code?: unknown }).code === "EADDRINUSE"
	);
}
