import type { BrowserApi } from "./browser-api-router.ts";
import { isWebSocketUpgradeRequest } from "./websocket-routing.ts";

interface TerminalUpgradeServer {
	upgrade(
		req: Request,
		options: {
			data: {
				clientType: "browser";
				socketType: "terminal";
				terminalCwd?: string;
			};
		},
	): boolean;
}

export function handleTerminalGatewayRequest(
	req: Request,
	url: URL,
	server: TerminalUpgradeServer,
	browserApi: BrowserApi | undefined,
): Response | undefined {
	if (!isWebSocketUpgradeRequest(req)) {
		return new Response("outclaw runtime", { status: 200 });
	}

	const repositoryId = url.searchParams.get("repositoryId") ?? undefined;
	const agentId = url.searchParams.get("agentId") ?? undefined;
	const terminalCwd = browserApi
		? repositoryId
			? browserApi.getCodingRepositoryCwd?.(repositoryId)
			: agentId
				? browserApi.getAgentTerminalCwd(agentId)
				: undefined
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
		return undefined;
	}
	return new Response("WebSocket upgrade failed", { status: 400 });
}
