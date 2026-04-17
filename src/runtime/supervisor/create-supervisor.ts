import type {
	BrowserAgentsResponse,
	BrowserCronEntry,
	BrowserFileResponse,
	BrowserGitDiffResponse,
	BrowserGitStatusResponse,
	BrowserTreeEntry,
	RuntimeClientType,
} from "../../common/protocol.ts";
import type { AgentRuntime } from "../application/create-agent-runtime.ts";
import { createBrowserSidebarWatcher } from "../browser/browser-sidebar-watcher.ts";
import { TerminalRelay } from "../browser/terminal-relay.ts";
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
	browserApi?: {
		getAgentTerminalCwd(agentId: string): string | undefined;
		listAgents(): BrowserAgentsResponse;
		listAgentCron(agentId: string): Promise<BrowserCronEntry[]>;
		listAgentTree(agentId: string): Promise<BrowserTreeEntry[]>;
		readAgentFile(
			agentId: string,
			relativePath: string,
		): Promise<BrowserFileResponse>;
		readGitDiff(path: string): Promise<BrowserGitDiffResponse>;
		readGitStatus(): Promise<BrowserGitStatusResponse>;
		setAgentCronEnabled(
			agentId: string,
			relativePath: string,
			enabled: boolean,
		): Promise<BrowserCronEntry>;
	};
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

	const server = Bun.serve<{
		clientType: RuntimeClientType;
		socketType: "runtime" | "terminal";
		requestedAgentName?: string;
		terminalCwd?: string;
		telegramBotId?: string;
		telegramUserId?: number;
	}>({
		port: options.port,
		async fetch(req, server) {
			const url = new URL(req.url);
			if (url.pathname.startsWith("/api/")) {
				return await handleBrowserApiRequest(req, url, options.browserApi);
			}

			if (url.pathname === "/terminal") {
				if (!isWebSocketUpgradeRequest(req)) {
					return new Response("outclaw runtime", { status: 200 });
				}
				const agentId = url.searchParams.get("agentId") ?? undefined;
				const terminalCwd =
					agentId && options.browserApi
						? options.browserApi.getAgentTerminalCwd(agentId)
						: undefined;
				if (
					server.upgrade(req, {
						data: {
							clientType: "browser",
							socketType: "terminal",
							terminalCwd,
						},
					})
				) {
					return;
				}
				return new Response("WebSocket upgrade failed", { status: 400 });
			}

			if (!isRuntimeSocketPath(url.pathname)) {
				return new Response("outclaw runtime", { status: 200 });
			}
			if (!isWebSocketUpgradeRequest(req)) {
				return new Response("outclaw runtime", { status: 200 });
			}

			const clientType = resolveClientType(url);
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

async function handleBrowserApiRequest(
	req: Request,
	url: URL,
	browserApi: CreateSupervisorOptions["browserApi"],
) {
	if (!browserApi) {
		return jsonError("Browser API is not configured", 404);
	}

	try {
		if (url.pathname === "/api/agents") {
			return Response.json(browserApi.listAgents());
		}

		if (url.pathname === "/api/git/status") {
			return Response.json(await browserApi.readGitStatus());
		}

		if (url.pathname === "/api/git/diff") {
			const path = url.searchParams.get("path");
			if (!path) {
				return jsonError("Missing path query parameter", 400);
			}
			return Response.json(await browserApi.readGitDiff(path));
		}

		const agentMatch = url.pathname.match(
			/^\/api\/agents\/([^/]+)\/(tree|files|cron)$/,
		);
		if (!agentMatch) {
			return jsonError("Not found", 404);
		}

		const [, encodedAgentId, resource] = agentMatch;
		const agentId = decodeURIComponent(encodedAgentId ?? "");
		if (resource === "cron" && req.method === "PATCH") {
			const body = (await req.json().catch(() => undefined)) as
				| { enabled?: boolean; path?: string }
				| undefined;
			if (!body?.path || typeof body.enabled !== "boolean") {
				return jsonError("Missing cron path or enabled state", 400);
			}
			return Response.json(
				await browserApi.setAgentCronEnabled(agentId, body.path, body.enabled),
			);
		}

		if (req.method !== "GET") {
			return jsonError("Method not allowed", 405);
		}

		if (resource === "tree") {
			return Response.json(await browserApi.listAgentTree(agentId));
		}
		if (resource === "cron") {
			return Response.json(await browserApi.listAgentCron(agentId));
		}

		const path = url.searchParams.get("path");
		if (!path) {
			return jsonError("Missing path query parameter", 400);
		}
		return Response.json(await browserApi.readAgentFile(agentId, path));
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unexpected error";
		const status = message.startsWith("Unknown agent:")
			? 404
			: message === "Path is required"
				? 400
				: message.startsWith("Path escapes") ||
						message === "Path escapes cron directory" ||
						message === "Path does not reference a file"
					? 400
					: 500;
		return jsonError(message, status);
	}
}

function jsonError(message: string, status: number) {
	return Response.json(
		{
			error: message,
		},
		{ status },
	);
}

function isRuntimeSocketPath(pathname: string): boolean {
	return pathname === "/" || pathname === "/ws";
}

function isWebSocketUpgradeRequest(req: Request): boolean {
	return req.headers.get("upgrade")?.toLowerCase() === "websocket";
}

function resolveClientType(url: URL): RuntimeClientType {
	const client = url.searchParams.get("client");
	if (client === "telegram" || client === "browser" || client === "control") {
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
