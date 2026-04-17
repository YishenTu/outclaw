import {
	DEFAULT_EFFORT,
	EFFORT_LEVELS,
	isEffortLevel,
	isOpusOnlyEffort,
} from "../../common/commands.ts";
import {
	isModelAlias,
	MODEL_ALIAS_LIST,
	MODELS,
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
	if (options.command === "/model" || options.command.startsWith("/model ")) {
		const modelArg = options.command.split(" ")[1]?.trim();
		handleModelCommand(options, modelArg);
		return true;
	}

	const aliasArg = MODEL_ALIAS_LIST.find(
		(model) => options.command === `/${model}`,
	);
	if (aliasArg) {
		handleModelCommand(options, aliasArg);
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

	const usage = options.state.usage;
	if (usage) {
		const targetWindow = MODELS[modelArg].contextWindow;
		const cap = Math.round(targetWindow * 0.8);
		if (usage.contextTokens > cap) {
			sendError(
				options.hub,
				options.ws,
				`context too large for ${modelArg} (${usage.contextTokens}/${cap}) — run /compact first`,
			);
			return;
		}
	}

	options.state.setModel(modelArg as ModelAlias);
	options.hub.broadcast(buildModelChangedEvent(modelArg));

	if (modelArg !== "opus" && isOpusOnlyEffort(options.state.effort)) {
		options.state.setEffort(DEFAULT_EFFORT);
		options.hub.broadcast(buildEffortChangedEvent(DEFAULT_EFFORT));
	}
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

	if (isOpusOnlyEffort(effortArg) && options.state.model !== "opus") {
		sendError(
			options.hub,
			options.ws,
			`Effort '${effortArg}' requires the opus model (current: ${options.state.model})`,
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
