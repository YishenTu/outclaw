import type { RuntimeClientType } from "../../common/protocol.ts";

export function isRuntimeSocketPath(pathname: string): boolean {
	return pathname === "/" || pathname === "/ws";
}

export function isWebSocketUpgradeRequest(req: Request): boolean {
	return req.headers.get("upgrade")?.toLowerCase() === "websocket";
}

export function resolveRuntimeClientType(url: URL): RuntimeClientType {
	const client = url.searchParams.get("client");
	if (client === "telegram" || client === "browser" || client === "control") {
		return client;
	}
	return "tui";
}

export function resolveTelegramUserId(url: URL): number | undefined {
	const value = url.searchParams.get("telegramUserId");
	if (!value) {
		return undefined;
	}

	const parsed = Number(value);
	return Number.isInteger(parsed) ? parsed : undefined;
}
