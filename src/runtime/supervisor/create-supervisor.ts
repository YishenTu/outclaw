import type { RuntimeClientType } from "../../common/protocol.ts";
import type { AgentRuntime } from "../application/create-agent-runtime.ts";
import { createBrowserSidebarWatcher } from "../browser/sidebar/watcher.ts";
import { BrowserTerminalManager } from "../browser/terminal/manager.ts";
import type { CodingSessionEventRecorder } from "../coding/index.ts";
import { AgentRuntimeRegistry } from "./agent-runtime-registry.ts";
import {
	type BrowserApi,
	handleBrowserApiRequest,
} from "./browser-api-router.ts";
import { type BrowserApp, serveBrowserApp } from "./browser-app.ts";
import { ClientAgentBinding } from "./client-agent-binding.ts";
import {
	buildClientIdCookieHeader,
	generateClientId,
	parseClientIdCookie,
} from "./cookies.ts";
import { SupervisorController } from "./supervisor-controller.ts";
import { resolveBrowserTerminalCwd } from "./terminal-target.ts";
import {
	isRuntimeSocketPath,
	isWebSocketUpgradeRequest,
	resolveRuntimeClientType,
	resolveTelegramUserId,
} from "./websocket-routing.ts";

interface SupervisorSocketData {
	clientType: RuntimeClientType;
	cookieClientId?: string;
	requestedAgentName?: string;
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
	codingEvents?: CodingSessionEventRecorder;
	browserWatch?: {
		agents: Array<{
			agentId: string;
			rootDir: string;
		}>;
		createWatcher?: typeof createBrowserSidebarWatcher;
		gitRoot: string;
	};
	emitAgentEvents?: boolean;
	/**
	 * Reads the agent id remembered for a given browser cookie client_id.
	 * When absent (no cookie / unknown client), the supervisor falls back to the
	 * first agent in config order. Decoupled from getDefaultAgentId, which is
	 * the TUI-only global slot.
	 */
	getBrowserClientAgentId?: (clientId: string) => string | undefined;
	getDefaultAgentId?: () => string | undefined;
	hostname?: string;
	port: number;
	/**
	 * Persists "this browser cookie client_id last picked agent X". Called only
	 * on explicit agent switches, never on initial bind, so a fresh visitor that
	 * never switches doesn't accumulate stale mappings.
	 */
	rememberBrowserClientAgentId?: (clientId: string, agentId: string) => void;
	rememberInteractiveAgentId?: (agentId: string) => void;
	telegramRouting?: TelegramRoutingOptions;
}

export function createSupervisor(options: CreateSupervisorOptions) {
	const registry = new AgentRuntimeRegistry(options.agents);
	const bindings = new ClientAgentBinding(
		registry,
		options.getDefaultAgentId,
		options.telegramRouting,
		options.getBrowserClientAgentId,
	);
	const browserTerminalManager = new BrowserTerminalManager();
	const controller = new SupervisorController({
		bindings,
		emitAgentEvents: options.emitAgentEvents,
		linkChatCodingSession: options.browserApi?.linkChatCodingSession
			? (event) => options.browserApi?.linkChatCodingSession?.(event)
			: undefined,
		rememberBrowserClientAgentId: options.rememberBrowserClientAgentId,
		rememberInteractiveAgentId: options.rememberInteractiveAgentId,
		registry,
		resolveTerminalCwd: (target) =>
			resolveBrowserTerminalCwd(target, options.browserApi),
		terminalManager: browserTerminalManager,
		telegramRouting: options.telegramRouting,
	});
	for (const runtime of options.agents) {
		runtime.setActiveSessionChangedHandler(
			({ activeSessionId, agentId, providerId }) =>
				controller.broadcastBrowserAgentActiveSessionChanged({
					type: "browser_agent_active_session_changed",
					agentId,
					activeSession: activeSessionId
						? {
								providerId,
								sdkSessionId: activeSessionId,
							}
						: undefined,
				}),
		);
		runtime.setSessionCatalogChangedHandler(({ agentId }) =>
			controller.broadcastBrowserAgentsInvalidated({
				type: "browser_agents_invalidated",
				agentId,
			}),
		);
	}
	const browserSidebarWatcher = options.browserWatch
		? (options.browserWatch.createWatcher ?? createBrowserSidebarWatcher)({
				agents: options.browserWatch.agents,
				gitRoot: options.browserWatch.gitRoot,
				onInvalidate: (event) =>
					controller.broadcastBrowserSidebarInvalidated(event),
			})
		: undefined;
	const unsubscribeCodingEvents = options.codingEvents?.subscribeAll?.(
		(event) =>
			controller.broadcastCodingSessionEvent({
				type: "coding_session_event",
				...event,
			}),
	);
	const server = createSupervisorServer({
		hostname: options.hostname,
		port: options.port,
		async fetch(req, server) {
			const url = new URL(req.url);
			const clientType = resolveRuntimeClientType(url);
			// Browser clients get a stable cookie so the daemon can remember which
			// agent each browser last picked across reconnects/restarts. Mint on
			// first sight and attach Set-Cookie to whatever response we return for
			// this request — the cookie travels back the same way it arrived
			// (HTML response, WS upgrade response, or plain 200).
			const existingCookieClientId = parseClientIdCookie(req);
			const isBrowserRequest =
				clientType === "browser" || isLikelyBrowserHttpRequest(req, url);
			const cookieClientId =
				existingCookieClientId ??
				(isBrowserRequest ? generateClientId() : undefined);
			const newCookieHeader =
				existingCookieClientId === undefined && cookieClientId !== undefined
					? buildClientIdCookieHeader(cookieClientId)
					: undefined;

			if (url.pathname.startsWith("/api/")) {
				return attachSetCookie(
					await handleBrowserApiRequest(req, url, options.browserApi, {
						browserClientId: cookieClientId,
						onChatCodingLinksChanged: (event) =>
							controller.broadcastBrowserChatCodingLinksChanged(event),
					}),
					newCookieHeader,
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
							return attachSetCookie(browserAppResponse, newCookieHeader);
						}
					}
					return attachSetCookie(
						new Response("outclaw runtime", { status: 200 }),
						newCookieHeader,
					);
				}
			} else {
				const browserAppResponse = serveBrowserApp(
					req.method,
					url.pathname,
					options.browserApp,
				);
				if (browserAppResponse) {
					return attachSetCookie(browserAppResponse, newCookieHeader);
				}
				return attachSetCookie(
					new Response("outclaw runtime", { status: 200 }),
					newCookieHeader,
				);
			}

			const requestedAgentName = url.searchParams.get("agent") ?? undefined;
			const telegramBotId = url.searchParams.get("telegramBotId") ?? undefined;
			const telegramUserId = resolveTelegramUserId(url);
			const upgradeOptions: Parameters<typeof server.upgrade>[1] = {
				data: {
					clientType,
					cookieClientId,
					requestedAgentName,
					telegramBotId,
					telegramUserId,
				},
			};
			if (newCookieHeader) {
				upgradeOptions.headers = { "Set-Cookie": newCookieHeader };
			}
			if (server.upgrade(req, upgradeOptions)) {
				return;
			}
			return new Response("WebSocket upgrade failed", { status: 400 });
		},
		websocket: {
			close(ws) {
				controller.handleClose(ws);
			},
			message(ws, message) {
				controller.handleMessage(ws, message);
			},
			open(ws) {
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
					unsubscribeCodingEvents?.();
					browserTerminalManager.stopAll();
					await registry.stopAll();
					server.stop();
				})();
			}
			return stopPromise;
		},
	};
}

function attachSetCookie(
	response: Response,
	setCookieHeader: string | undefined,
): Response {
	if (!setCookieHeader) {
		return response;
	}

	const headers = new Headers(response.headers);
	headers.append("Set-Cookie", setCookieHeader);
	return new Response(response.body, {
		headers,
		status: response.status,
		statusText: response.statusText,
	});
}

/**
 * Heuristic: does this look like a browser HTTP request that should mint a
 * cookie? We don't want to mint cookies for, e.g., curl probes or other
 * non-browser HTTP clients (they'd just be ignored anyway, but minting still
 * costs a UUID + Set-Cookie header round-trip and pollutes the state table if
 * the client ever reaches a switch path). Practical signal: presence of an
 * Accept header that looks HTML-y, or a User-Agent that looks like a browser.
 * Conservative; falls back to "skip mint" when uncertain. WebSocket upgrades
 * are handled separately based on clientType=browser.
 */
function isLikelyBrowserHttpRequest(req: Request, url: URL): boolean {
	if (isWebSocketUpgradeRequest(req)) {
		return false;
	}
	if (url.pathname.startsWith("/api/")) {
		// API endpoints are reached by an already-loaded browser page, which
		// already has its cookie set. No need to mint here.
		return false;
	}
	const accept = req.headers.get("accept") ?? "";
	if (accept.includes("text/html")) {
		return true;
	}
	const ua = req.headers.get("user-agent") ?? "";
	return /Mozilla|Chrome|Safari|Firefox|Edge/.test(ua);
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
