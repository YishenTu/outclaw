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
import type { ClientHub, WsClient } from "../transport/client-hub.ts";

interface HandleRuntimeSettingsCommandOptions {
	command: string;
	hub: ClientHub;
	state: RuntimeState;
	ws: WsClient;
}

export function handleRuntimeSettingsCommand(
	options: HandleRuntimeSettingsCommandOptions,
): boolean {
	const modelArg = options.command.startsWith("/model ")
		? options.command.split(" ")[1]?.trim()
		: MODEL_ALIAS_LIST.find((model) => options.command === `/${model}`);
	if (
		options.command === "/model" ||
		options.command.startsWith("/model ") ||
		modelArg
	) {
		handleModelCommand(options, modelArg);
		return true;
	}

	if (
		options.command === "/thinking" ||
		options.command.startsWith("/thinking ")
	) {
		const effortArg = options.command.split(" ")[1]?.trim();
		handleThinkingCommand(options, effortArg);
		return true;
	}

	return false;
}

function handleModelCommand(
	options: HandleRuntimeSettingsCommandOptions,
	modelArg: string | undefined,
) {
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
}

function handleThinkingCommand(
	options: HandleRuntimeSettingsCommandOptions,
	effortArg: string | undefined,
) {
	if (!effortArg) {
		options.hub.send(options.ws, buildEffortChangedEvent(options.state.effort));
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

function sendError(hub: ClientHub, ws: WsClient, message: string) {
	hub.send(ws, { type: "error", message });
}

function buildModelChangedEvent(model: string): ModelChangedEvent {
	return { type: "model_changed", model };
}

function buildEffortChangedEvent(effort: string): EffortChangedEvent {
	return { type: "effort_changed", effort };
}
