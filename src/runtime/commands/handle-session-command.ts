import type { RuntimeStatusEvent } from "../../common/protocol.ts";
import type { SessionService } from "../application/session-service.ts";
import type { ClientHub, WsClient } from "../transport/client-hub.ts";

interface HandleSessionCommandOptions {
	arg: string;
	createStatusEvent: () => RuntimeStatusEvent;
	hub: ClientHub;
	replayHistoryToAll: (sessionId: string) => Promise<void>;
	sessions: SessionService;
	sendError: (message: string) => void;
	ws: WsClient;
}

export async function handleSessionCommand(
	options: HandleSessionCommandOptions,
) {
	if (!options.arg) {
		options.hub.send(options.ws, {
			type: "session_menu",
			activeSessionId: options.sessions.activeSessionId,
			sessions: options.sessions.listSessions(),
		});
		return;
	}

	if (options.arg === "delete" || options.arg.startsWith("delete ")) {
		const deleteId = options.arg.split(" ").slice(1).join(" ").trim();
		if (!deleteId) {
			options.sendError("Usage: /session delete <id>");
			return;
		}
		const deletion = options.sessions.deleteSession(deleteId);
		options.hub.broadcast({
			type: "session_deleted",
			sdkSessionId: deleteId,
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
			options.sendError("Usage: /session rename <id> <title>");
			return;
		}
		options.sessions.renameSession(renameId, newTitle);
		options.hub.broadcast({
			type: "session_renamed",
			sdkSessionId: renameId,
			title: newTitle,
		});
		return;
	}

	if (options.arg === "list") {
		options.hub.send(options.ws, {
			type: "session_list",
			sessions: options.sessions.listSessions(),
		});
		return;
	}

	const match = options.sessions.switchToSession(options.arg);
	if (!match) {
		options.sendError(`No session matching: ${options.arg}`);
		return;
	}

	options.hub.broadcast({
		type: "session_switched",
		sdkSessionId: match.sdkSessionId,
		title: match.title,
	});
	options.hub.broadcast(options.createStatusEvent());
	await options.replayHistoryToAll(match.sdkSessionId);
}
