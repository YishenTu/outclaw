import {
	DEFAULT_EFFORT,
	EFFORT_LEVELS,
	type EffortLevel,
	isEffortLevel,
	parseModelShortcutCommand,
} from "../../common/commands.ts";
import type {
	EffortChangedEvent,
	ModelChangedEvent,
	ProviderModelInfo,
} from "../../common/protocol.ts";
import type { RuntimeState } from "../application/state/runtime-state.ts";
import type { ModelProviderResolver } from "../model-provider-resolver.ts";
import type { ClientHub, WsClient } from "../transport/client-hub.ts";

interface HandleRuntimeSettingsCommandOptions {
	command: string;
	hub: ClientHub;
	modelProviderResolver?: ModelProviderResolver;
	selectProviderModel?: (selection: {
		contextWindow?: number;
		effort?: EffortLevel;
		model: string;
		providerId: string;
	}) => void;
	state: RuntimeState;
	ws: WsClient;
}

export async function handleRuntimeSettingsCommand(
	options: HandleRuntimeSettingsCommandOptions,
): Promise<boolean> {
	const modelShortcut = parseModelShortcutCommand(options.command);
	if (modelShortcut) {
		await handleModelCommand(options, modelShortcut);
		return true;
	}

	if (options.command === "/model" || options.command.startsWith("/model ")) {
		const modelArg = options.command.split(" ")[1]?.trim();
		await handleModelCommand(options, modelArg);
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

async function handleModelCommand(
	options: HandleRuntimeSettingsCommandOptions,
	modelArg: string | undefined,
): Promise<void> {
	if (!modelArg) {
		options.hub.send(
			options.ws,
			buildModelChangedEvent(options.state.model, options.state.providerId),
		);
		return;
	}

	const selection =
		await options.modelProviderResolver?.resolveModelSelection(modelArg);
	if (!selection) {
		if (options.modelProviderResolver) {
			sendError(
				options.hub,
				options.ws,
				`Invalid model: ${modelArg}${await validModelsSuffix(options.modelProviderResolver)}`,
			);
			return;
		}
		applyModelSelection(options, {
			providerId: options.state.providerId,
			model: genericProviderModel(modelArg),
		});
		return;
	}

	applyModelSelection(options, selection);
}

function applyModelSelection(
	options: HandleRuntimeSettingsCommandOptions,
	selection: { providerId: string; model: ProviderModelInfo },
) {
	const usage = options.state.usage;
	if (usage) {
		const cap = contextWindowSwitchLimit(selection.model.contextWindow);
		if (usage.contextTokens > cap) {
			sendError(
				options.hub,
				options.ws,
				`context too large for ${selection.model.model} (${usage.contextTokens}/${cap}) — run /compact first`,
			);
			return;
		}
	}

	const nextEffort = compatibleEffortForModel(
		options.state.effort,
		options.state.defaultEffort,
		selection.model,
	);
	if (options.selectProviderModel) {
		options.selectProviderModel({
			providerId: selection.providerId,
			model: selection.model.model,
			...(selection.model.contextWindow !== undefined
				? { contextWindow: selection.model.contextWindow }
				: {}),
			...(nextEffort !== options.state.effort ? { effort: nextEffort } : {}),
		});
		return;
	}

	const previousEffort = options.state.effort;
	options.state.setProviderModel(selection.model.model, {
		contextWindow: selection.model.contextWindow,
	});
	if (nextEffort !== options.state.effort) {
		options.state.setEffort(nextEffort);
	}
	options.hub.broadcast(
		buildModelChangedEvent(selection.model.model, options.state.providerId),
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

	options.state.setEffort(effortArg);
	options.hub.broadcast(
		buildEffortChangedEvent(effortArg, options.state.providerId),
	);
}

function sendError(hub: ClientHub, ws: WsClient, message: string) {
	hub.send(ws, { type: "error", message });
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

function contextWindowSwitchLimit(
	contextWindow: number | undefined,
	fraction = 0.8,
): number {
	return contextWindow
		? Math.round(contextWindow * fraction)
		: Number.POSITIVE_INFINITY;
}

function compatibleEffortForModel(
	effort: EffortLevel,
	defaultEffort: EffortLevel,
	model: ProviderModelInfo,
): EffortLevel {
	const levels = model.supportedReasoningEfforts.filter(
		(level): level is EffortLevel => isEffortLevel(level),
	);
	if (levels.length === 0 || levels.includes(effort)) {
		return effort;
	}
	if (levels.includes(defaultEffort)) {
		return defaultEffort;
	}
	if (
		isEffortLevel(model.defaultReasoningEffort) &&
		levels.includes(model.defaultReasoningEffort)
	) {
		return model.defaultReasoningEffort;
	}
	return levels[0] ?? DEFAULT_EFFORT;
}

function genericProviderModel(model: string): ProviderModelInfo {
	return {
		id: model,
		model,
		displayName: model,
		description: "",
		isDefault: false,
		defaultReasoningEffort: DEFAULT_EFFORT,
		supportedReasoningEfforts: [],
		serviceTiers: [],
	};
}

async function validModelsSuffix(
	resolver: ModelProviderResolver,
): Promise<string> {
	const models = await resolver.listModelSelections();
	if (models.length === 0) {
		return "";
	}
	const labels = models.map((entry) => entry.model.model).join(", ");
	return `. Valid: ${labels}`;
}
