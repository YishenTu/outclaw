export const MODELS = {
	opus: { id: "claude-opus-4-7[1m]", contextWindow: 1_000_000 },
	sonnet: { id: "sonnet", contextWindow: 200_000 },
	haiku: { id: "haiku", contextWindow: 200_000 },
} as const;

export type ModelAlias = keyof typeof MODELS;

export interface ModelAliasMetadata {
	alias: ModelAlias;
	contextWindow: number;
	id: string;
}

export const MODEL_ALIAS_LIST = Object.keys(MODELS) as ModelAlias[];

export function isModelAlias(value: string): value is ModelAlias {
	return Object.hasOwn(MODELS, value);
}

export function getModelAliasMetadata(
	value: string,
): ModelAliasMetadata | undefined {
	if (!isModelAlias(value)) {
		return undefined;
	}

	return {
		alias: value,
		contextWindow: MODELS[value].contextWindow,
		id: MODELS[value].id,
	};
}

export function resolveModelAlias(value: string): string {
	return getModelAliasMetadata(value)?.id ?? value;
}

export function contextWindowForAlias(value: string): number | undefined {
	return getModelAliasMetadata(value)?.contextWindow;
}

const resolvedModelIndex = new Map<string, number>(
	MODEL_ALIAS_LIST.map((alias) => [
		MODELS[alias].id,
		MODELS[alias].contextWindow,
	]),
);

const resolvedModelAliasIndex = new Map<string, ModelAlias>(
	MODEL_ALIAS_LIST.map((alias) => [MODELS[alias].id, alias]),
);

export function contextWindowForResolvedModel(
	resolvedModel: string,
): number | undefined {
	return resolvedModelIndex.get(resolvedModel);
}

export function modelAliasForModel(model: string): ModelAlias | undefined {
	if (isModelAlias(model)) {
		return model;
	}

	return resolvedModelAliasIndex.get(model);
}

export function contextWindowSwitchLimitForAlias(
	value: string,
	fraction = 0.8,
): number | undefined {
	const contextWindow = contextWindowForAlias(value);
	if (!contextWindow) {
		return undefined;
	}

	return Math.round(contextWindow * fraction);
}
