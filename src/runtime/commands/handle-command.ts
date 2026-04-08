import { EFFORT_LEVELS, isEffortLevel } from "../../common/commands.ts";
import {
	isModelAlias,
	MODEL_ALIAS_LIST,
	type ModelAlias,
} from "../../common/models.ts";
import type {
	EffortChangedEvent,
	ModelChangedEvent,
} from "../../common/protocol.ts";
import type { RuntimeState } from "../application/runtime-state.ts";
import type { SessionStore } from "../persistence/session-store.ts";
import type { ClientHub, WsClient } from "../transport/client-hub.ts";

interface HandleRuntimeCommandOptions {
	command: string;
	hub: ClientHub;
	replayHistoryToAll: (sessionId: string) => Promise<void>;
	state: RuntimeState;
	store?: SessionStore;
	ws: WsClient;
}

function sendError(hub: ClientHub, ws: WsClient, message: string) {
	hub.send(ws, { type: "error", message });
}

function buildModelChangedEvent(model: string): ModelChangedEvent {
	return { type: "model_changed", model };
}

function buildEffortChangedEvent(effort: string): EffortChangedEvent {
	return { type: "effort_changed", effort };
}

export async function handleRuntimeCommand(
	options: HandleRuntimeCommandOptions,
) {
	const command = options.command.trim();

	if (command === "/status") {
		options.hub.send(options.ws, options.state.createStatusEvent());
		return;
	}

	if (command === "/new") {
		options.state.clearSession();
		options.hub.broadcast({ type: "session_cleared" });
		return;
	}

	if (command === "/session" || command.startsWith("/session ")) {
		const arg = command.split(" ").slice(1).join(" ").trim();

		if (!arg) {
			const sessionId = options.state.sessionId;
			if (!sessionId) {
				sendError(options.hub, options.ws, "No active session");
				return;
			}

			const row = options.store?.get(sessionId);
			options.hub.send(options.ws, {
				type: "session_info",
				sdkSessionId: sessionId,
				title: row?.title ?? options.state.sessionTitle ?? "Untitled",
				model: row?.model ?? options.state.model,
			});
			return;
		}

		if (arg === "list") {
			const sessions = (options.store?.list() ?? []).map((session) => ({
				sdkSessionId: session.sdkSessionId,
				title: session.title,
				model: session.model,
				lastActive: session.lastActive,
			}));
			options.hub.send(options.ws, { type: "session_list", sessions });
			return;
		}

		const match = (options.store?.list() ?? []).find((session) =>
			session.sdkSessionId.startsWith(arg),
		);
		if (!match) {
			sendError(options.hub, options.ws, `No session matching: ${arg}`);
			return;
		}

		options.state.switchToSession(match);
		options.hub.broadcast({
			type: "session_switched",
			sdkSessionId: match.sdkSessionId,
			title: match.title,
		});
		await options.replayHistoryToAll(match.sdkSessionId);
		return;
	}

	const modelArg = command.startsWith("/model ")
		? command.split(" ")[1]?.trim()
		: MODEL_ALIAS_LIST.find((model) => command === `/${model}`);
	if (command === "/model" || command.startsWith("/model ") || modelArg) {
		if (!modelArg) {
			options.hub.send(options.ws, buildModelChangedEvent(options.state.model));
			return;
		}

		if (!isModelAlias(modelArg)) {
			sendError(
				options.hub,
				options.ws,
				`Invalid model: ${modelArg}. Valid: ${MODEL_ALIAS_LIST.join(", ")}`,
			);
			return;
		}

		options.state.setModel(modelArg as ModelAlias);
		options.hub.broadcast(buildModelChangedEvent(modelArg));
		return;
	}

	if (command === "/thinking" || command.startsWith("/thinking ")) {
		const effortArg = command.split(" ")[1]?.trim();
		if (!effortArg) {
			options.hub.send(
				options.ws,
				buildEffortChangedEvent(options.state.effort),
			);
			return;
		}

		if (!isEffortLevel(effortArg)) {
			sendError(
				options.hub,
				options.ws,
				`Invalid effort: ${effortArg}. Valid: ${EFFORT_LEVELS.join(", ")}`,
			);
			return;
		}

		options.state.setEffort(effortArg);
		options.hub.broadcast(buildEffortChangedEvent(effortArg));
	}
}
