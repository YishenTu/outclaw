import {
	EFFORT_LEVELS,
	isEffortAllowedForModel,
	isEffortLevel,
} from "../../common/commands.ts";
import {
	contextWindowSwitchLimitForAlias,
	isModelAlias,
	MODEL_ALIAS_LIST,
	type ModelAlias,
} from "../../common/models.ts";
import type {
	EffortChangedEvent,
	ModelChangedEvent,
} from "../../common/protocol.ts";
import type { RuntimeState } from "../application/state/runtime-state.ts";
import type { ClientHub, WsClient } from "../transport/client-hub.ts";

interface HandleRuntimeSettingsCommandOptions {
	command: string;
	hub: ClientHub;
	selectProviderModel?: (selection: {
		model: string;
		providerId: string;
	}) => void;
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
		options.hub.send(
			options.ws,
			buildModelChangedEvent(options.state.model, options.state.providerId),
		);
		return;
	}

	const providerSelection = parseProviderModelArg(modelArg);
	if (providerSelection) {
		if (!options.selectProviderModel) {
			sendError(
				options.hub,
				options.ws,
				`Invalid model: ${modelArg}. Valid: ${MODEL_ALIAS_LIST.join(", ")}`,
			);
			return;
		}
		options.selectProviderModel(providerSelection);
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
		const cap = contextWindowSwitchLimitForAlias(modelArg);
		if (!cap) {
			sendError(
				options.hub,
				options.ws,
				`Invalid model: ${modelArg}. Valid: ${MODEL_ALIAS_LIST.join(", ")}`,
			);
			return;
		}
		if (usage.contextTokens > cap) {
			sendError(
				options.hub,
				options.ws,
				`context too large for ${modelArg} (${usage.contextTokens}/${cap}) — run /compact first`,
			);
			return;
		}
	}

	const previousEffort = options.state.effort;
	options.state.setModel(modelArg as ModelAlias);
	options.hub.broadcast(
		buildModelChangedEvent(modelArg, options.state.providerId),
	);

	if (options.state.effort !== previousEffort) {
		options.hub.broadcast(
			buildEffortChangedEvent(options.state.effort, options.state.providerId),
		);
	}

	options.hub.broadcast(options.state.createStatusEvent());
}

function handleThinkingCommand(
	options: HandleRuntimeSettingsCommandOptions,
	effortArg: string | undefined,
) {
	if (!effortArg) {
		options.hub.send(
			options.ws,
			buildEffortChangedEvent(options.state.effort, options.state.providerId),
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

	if (
		isModelAlias(options.state.model) &&
		!isEffortAllowedForModel(effortArg, options.state.model)
	) {
		sendError(
			options.hub,
			options.ws,
			`Effort '${effortArg}' requires the opus model (current: ${options.state.model})`,
		);
		return;
	}

	options.state.setEffort(effortArg);
	options.hub.broadcast(
		buildEffortChangedEvent(effortArg, options.state.providerId),
	);
}

function sendError(hub: ClientHub, ws: WsClient, message: string) {
	hub.send(ws, { type: "error", message });
}

function parseProviderModelArg(
	value: string,
): { providerId: string; model: string } | undefined {
	const separator = value.indexOf("/");
	if (separator <= 0 || separator === value.length - 1) {
		return undefined;
	}

	return {
		providerId: value.slice(0, separator),
		model: value.slice(separator + 1),
	};
}

function buildModelChangedEvent(
	model: string,
	providerId: string,
): ModelChangedEvent {
	return { type: "model_changed", model, providerId };
}

function buildEffortChangedEvent(
	effort: string,
	providerId: string,
): EffortChangedEvent {
	return { type: "effort_changed", effort, providerId };
}
