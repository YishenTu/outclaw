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
				terminalError?: string;
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
	const providerId = url.searchParams.get("providerId") ?? undefined;
	const sdkSessionId = url.searchParams.get("sdkSessionId") ?? undefined;
	const agentId = url.searchParams.get("agentId") ?? undefined;
	const target = resolveTerminalTarget({
		agentId,
		browserApi,
		providerId,
		repositoryId,
		sdkSessionId,
	});
	if (
		server.upgrade(req, {
			data: {
				clientType: "browser",
				socketType: "terminal",
				...(target.cwd ? { terminalCwd: target.cwd } : {}),
				...(target.error ? { terminalError: target.error } : {}),
			},
		})
	) {
		return undefined;
	}
	return new Response("WebSocket upgrade failed", { status: 400 });
}

function resolveTerminalTarget(params: {
	agentId?: string;
	browserApi: BrowserApi | undefined;
	providerId?: string;
	repositoryId?: string;
	sdkSessionId?: string;
}): { cwd?: string; error?: string } {
	if (!params.browserApi) {
		return { error: "Browser terminal API is not configured" };
	}
	try {
		if (params.repositoryId) {
			const cwd = params.browserApi.getCodingRepositoryCwd?.(
				params.repositoryId,
				{
					...(params.providerId ? { providerId: params.providerId } : {}),
					...(params.sdkSessionId ? { sdkSessionId: params.sdkSessionId } : {}),
				},
			);
			return cwd
				? { cwd }
				: { error: "Coding repository terminal workspace is not available" };
		}
		if (params.agentId) {
			const cwd = params.browserApi.getAgentTerminalCwd(params.agentId);
			return cwd
				? { cwd }
				: { error: "Agent terminal workspace is not available" };
		}
		return { error: "Terminal target is not specified" };
	} catch (error) {
		return { error: formatError(error) };
	}
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
