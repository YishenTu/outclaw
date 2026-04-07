export const DEFAULT_MODEL = "opus";
export const DEFAULT_EFFORT = "high";

export const MODEL_ALIASES = {
	opus: "claude-opus-4-6[1m]",
	sonnet: "sonnet",
	haiku: "haiku",
} as const;

export type ModelAlias = keyof typeof MODEL_ALIASES;

export const MODEL_ALIAS_LIST = Object.keys(MODEL_ALIASES) as ModelAlias[];
export const MODEL_ALIAS_COMMANDS = MODEL_ALIAS_LIST.map(
	(alias) => `/${alias}`,
) as string[];

export const EFFORT_LEVELS = ["low", "medium", "high", "max"] as const;

export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export const RUNTIME_COMMANDS = [
	{ command: "new", description: "Start a new conversation" },
	{ command: "model", description: "Switch model (opus/sonnet/haiku)" },
	{
		command: "thinking",
		description: "Set thinking effort (low/medium/high/max)",
	},
	{ command: "session", description: "Show/list/switch sessions" },
	{ command: "status", description: "Show model, effort, and context usage" },
	{ command: "stop", description: "Cancel the current agent run" },
] as const;

export function isModelAlias(value: string): value is ModelAlias {
	return Object.hasOwn(MODEL_ALIASES, value);
}

export function isEffortLevel(value: string): value is EffortLevel {
	return EFFORT_LEVELS.includes(value as EffortLevel);
}

export function resolveModelAlias(value: string): string {
	return isModelAlias(value) ? MODEL_ALIASES[value] : value;
}

export function isRuntimeCommand(input: string): boolean {
	const trimmed = input.trim();
	if (!trimmed.startsWith("/")) {
		return false;
	}

	return (
		trimmed === "/new" ||
		trimmed === "/stop" ||
		trimmed === "/status" ||
		trimmed === "/model" ||
		trimmed.startsWith("/model ") ||
		trimmed === "/thinking" ||
		trimmed.startsWith("/thinking ") ||
		trimmed === "/session" ||
		trimmed.startsWith("/session ") ||
		MODEL_ALIAS_COMMANDS.includes(trimmed)
	);
}
