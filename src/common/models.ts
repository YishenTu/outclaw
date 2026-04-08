export const MODEL_ALIASES = {
	opus: "claude-opus-4-6[1m]",
	sonnet: "sonnet",
	haiku: "haiku",
} as const;

export type ModelAlias = keyof typeof MODEL_ALIASES;

export const MODEL_ALIAS_LIST = Object.keys(MODEL_ALIASES) as ModelAlias[];

export function isModelAlias(value: string): value is ModelAlias {
	return Object.hasOwn(MODEL_ALIASES, value);
}

export function resolveModelAlias(value: string): string {
	return isModelAlias(value) ? MODEL_ALIASES[value] : value;
}
