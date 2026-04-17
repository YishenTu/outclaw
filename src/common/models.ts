export const MODELS = {
	opus: { id: "claude-opus-4-7[1m]", contextWindow: 1_000_000 },
	sonnet: { id: "sonnet", contextWindow: 200_000 },
	haiku: { id: "haiku", contextWindow: 200_000 },
} as const;

export type ModelAlias = keyof typeof MODELS;

export const MODEL_ALIAS_LIST = Object.keys(MODELS) as ModelAlias[];

export function isModelAlias(value: string): value is ModelAlias {
	return Object.hasOwn(MODELS, value);
}

export function resolveModelAlias(value: string): string {
	return isModelAlias(value) ? MODELS[value].id : value;
}

export function contextWindowForAlias(value: string): number | undefined {
	return isModelAlias(value) ? MODELS[value].contextWindow : undefined;
}

const resolvedModelIndex = new Map<string, number>(
	MODEL_ALIAS_LIST.map((alias) => [
		MODELS[alias].id,
		MODELS[alias].contextWindow,
	]),
);

export function contextWindowForResolvedModel(
	resolvedModel: string,
): number | undefined {
	return resolvedModelIndex.get(resolvedModel);
}
