import type {
	RuntimeStatusEvent,
	SessionCursor,
} from "../../common/protocol.ts";
import { validateSessionSearchQuery } from "../application/session-search-query.ts";
import type { SessionService } from "../application/session-service.ts";
import type { ClientHub, WsClient } from "../transport/client-hub.ts";

interface HandleSessionCommandOptions {
	arg: string;
	createStatusEvent: () => RuntimeStatusEvent;
	hub: ClientHub;
	replayHistoryToAll: (session: {
		providerId: string;
		sdkSessionId: string;
	}) => Promise<void>;
	sessions: SessionService;
	sendError: (message: string) => void;
	ws: WsClient;
}

export async function handleSessionCommand(
	options: HandleSessionCommandOptions,
) {
	if (!options.arg) {
		const result = options.sessions.listSessions({ limit: 10 });
		options.hub.send(options.ws, {
			type: "session_menu",
			activeSessionId: options.sessions.activeSessionId,
			sessions: result.sessions,
			nextCursor: result.nextCursor,
		});
		return;
	}

	if (options.arg === "delete" || options.arg.startsWith("delete ")) {
		const selector = options.arg.split(" ").slice(1).join(" ").trim();
		if (!selector) {
			options.sendError("Usage: /session delete <provider>/<id>");
			return;
		}
		const resolved = options.sessions.resolveSession(selector, "chat");
		if (resolved.status === "ambiguous") {
			options.sendError(`Ambiguous session matching: ${selector}`);
			return;
		}
		if (resolved.status === "not_found") {
			options.sendError(`No session matching: ${selector}`);
			return;
		}
		const session = resolved.session;
		const deletion = options.sessions.deleteResolvedSession(session);
		options.hub.broadcast({
			type: "session_deleted",
			sdkSessionId: session.sdkSessionId,
			providerId: session.providerId,
		});
		if (deletion.clearedActiveSession) {
			options.hub.broadcast({ type: "session_cleared" });
		}
		return;
	}

	if (options.arg === "rename" || options.arg.startsWith("rename ")) {
		const parts = options.arg.split(" ").slice(1);
		const renameId = parts[0]?.trim();
		const newTitle = parts.slice(1).join(" ").trim();
		if (!renameId || !newTitle) {
			options.sendError("Usage: /session rename <provider>/<id> <title>");
			return;
		}
		const resolved = options.sessions.resolveSession(renameId, "chat");
		if (resolved.status === "ambiguous") {
			options.sendError(`Ambiguous session matching: ${renameId}`);
			return;
		}
		if (resolved.status === "not_found") {
			options.sendError(`No session matching: ${renameId}`);
			return;
		}
		options.sessions.renameResolvedSession(resolved.session, newTitle);
		return;
	}

	if (options.arg === "list" || options.arg.startsWith("list ")) {
		const parsed = parseSessionListArgs(options.arg);
		if (typeof parsed === "string") {
			options.sendError(parsed);
			return;
		}
		const result = options.sessions.listSessions(parsed);
		options.hub.send(options.ws, {
			type: "session_list",
			activeSessionId: options.sessions.activeSessionId,
			sessions: result.sessions,
			nextCursor: result.nextCursor,
		});
		return;
	}

	if (options.arg === "search" || options.arg.startsWith("search ")) {
		const parsed = parseSessionSearchArgs(options.arg);
		if (typeof parsed === "string") {
			options.sendError(parsed);
			return;
		}
		const result = options.sessions.searchSessions(parsed);
		options.hub.send(options.ws, {
			type: "session_search_result",
			query: parsed.query,
			sessions: result.sessions,
			nextCursor: result.nextCursor,
		});
		return;
	}

	const resolved = options.sessions.resolveSession(options.arg, "chat");
	if (resolved.status === "ambiguous") {
		options.sendError(`Ambiguous session matching: ${options.arg}`);
		return;
	}
	if (resolved.status === "not_found") {
		options.sendError(`No session matching: ${options.arg}`);
		return;
	}
	const match = options.sessions.switchToResolvedSession(resolved.session);

	options.hub.broadcast({
		type: "session_switched",
		sdkSessionId: match.sdkSessionId,
		title: match.title,
		providerId: match.providerId,
	});
	options.hub.broadcast(options.createStatusEvent());
	await options.replayHistoryToAll({
		providerId: match.providerId,
		sdkSessionId: match.sdkSessionId,
	});
}

const LIST_USAGE =
	"Usage: /session list [limit] [cursorLastActive cursorSdkId]";
const SEARCH_USAGE =
	"Usage: /session search [--limit n] [--cursor lastActive sdkSessionId] <query>";

function parseSessionListArgs(
	arg: string,
): { cursor?: SessionCursor; limit?: number } | string {
	const parts = arg.split(/\s+/).slice(1);
	if (parts.length === 0) {
		return {};
	}
	if (parts.length !== 1 && parts.length !== 3) {
		return LIST_USAGE;
	}

	const limit = parsePositiveInteger(parts[0] ?? "");
	if (limit === undefined) {
		return LIST_USAGE;
	}
	if (parts.length === 1) {
		return { limit };
	}

	const lastActive = parseNonNegativeInteger(parts[1] ?? "");
	const sdkSessionId = parts[2]?.trim();
	if (lastActive === undefined || !sdkSessionId) {
		return LIST_USAGE;
	}

	return {
		cursor: { lastActive, sdkSessionId },
		limit,
	};
}

function parseSessionSearchArgs(
	arg: string,
): { cursor?: SessionCursor; limit?: number; query: string } | string {
	let rest = arg.slice("search".length).trim();
	let limit: number | undefined;
	let cursor: SessionCursor | undefined;

	while (rest.startsWith("--")) {
		const shifted = shiftToken(rest);
		if (!shifted) {
			return SEARCH_USAGE;
		}
		const [flag, afterFlag] = shifted;
		rest = afterFlag.trimStart();
		if (flag === "--") {
			break;
		}
		if (flag === "--limit") {
			const limitToken = shiftToken(rest);
			const parsedLimit = limitToken
				? parsePositiveInteger(limitToken[0])
				: undefined;
			if (!limitToken || parsedLimit === undefined) {
				return SEARCH_USAGE;
			}
			limit = parsedLimit;
			rest = limitToken[1].trimStart();
			continue;
		}
		if (flag === "--cursor") {
			const lastActiveToken = shiftToken(rest);
			const sdkSessionIdToken = lastActiveToken
				? shiftToken(lastActiveToken[1].trimStart())
				: undefined;
			if (!lastActiveToken || !sdkSessionIdToken) {
				return SEARCH_USAGE;
			}
			const lastActive = parseNonNegativeInteger(lastActiveToken[0]);
			const sdkSessionId = sdkSessionIdToken[0].trim();
			if (lastActive === undefined || !sdkSessionId) {
				return SEARCH_USAGE;
			}
			cursor = { lastActive, sdkSessionId };
			rest = sdkSessionIdToken[1].trimStart();
			continue;
		}

		return SEARCH_USAGE;
	}

	const query = rest.trim();
	if (!query) {
		return "Usage: /session search <query>";
	}
	const validation = validateSessionSearchQuery(query);
	if (!validation.ok) {
		return validation.message;
	}
	return { cursor, limit, query: validation.query };
}

function shiftToken(input: string): [string, string] | undefined {
	const trimmed = input.trimStart();
	if (!trimmed) {
		return undefined;
	}
	const match = trimmed.match(/^(\S+)(?:\s+([\s\S]*))?$/);
	if (!match) {
		return undefined;
	}
	return [match[1] ?? "", match[2] ?? ""];
}

function parsePositiveInteger(value: string): number | undefined {
	const parsed = Number.parseInt(value, 10);
	return Number.isInteger(parsed) && parsed > 0 && String(parsed) === value
		? parsed
		: undefined;
}

function parseNonNegativeInteger(value: string): number | undefined {
	const parsed = Number.parseInt(value, 10);
	return Number.isInteger(parsed) && parsed >= 0 && String(parsed) === value
		? parsed
		: undefined;
}
