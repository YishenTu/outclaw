import type { RuntimeStatusEvent } from "../../common/protocol.ts";
import type { RuntimeState } from "../application/runtime-state.ts";
import type { SessionService } from "../application/session-service.ts";
import type { ClientHub, WsClient } from "../transport/client-hub.ts";
import { handleRuntimeSettingsCommand } from "./handle-runtime-settings-command.ts";
import { handleSessionCommand } from "./handle-session-command.ts";

interface HandleRuntimeCommandOptions {
	command: string;
	createStatusEvent: () => RuntimeStatusEvent;
	hub: ClientHub;
	replayHistoryToAll: (sessionId: string) => Promise<void>;
	sessions: SessionService;
	state: RuntimeState;
	ws: WsClient;
}

function sendError(hub: ClientHub, ws: WsClient, message: string) {
	hub.send(ws, { type: "error", message });
}

export async function handleRuntimeCommand(
	options: HandleRuntimeCommandOptions,
) {
	const command = options.command.trim();

	if (command === "/status") {
		options.hub.send(options.ws, {
			...options.createStatusEvent(),
			requested: true,
		});
		return;
	}

	if (command === "/new") {
		options.sessions.clearActiveSession();
		options.hub.broadcast({ type: "session_cleared" });
		options.hub.broadcast(options.createStatusEvent());
		return;
	}

	if (command === "/session" || command.startsWith("/session ")) {
		const arg = command.split(" ").slice(1).join(" ").trim();
		await handleSessionCommand({
			arg,
			createStatusEvent: options.createStatusEvent,
			hub: options.hub,
			replayHistoryToAll: options.replayHistoryToAll,
			sessions: options.sessions,
			sendError: (message) => sendError(options.hub, options.ws, message),
			ws: options.ws,
		});
		return;
	}

	if (
		handleRuntimeSettingsCommand({
			command,
			hub: options.hub,
			state: options.state,
			ws: options.ws,
		})
	) {
		return;
	}
}
