import { MODEL_ALIAS_LIST } from "./models.ts";

export const DEFAULT_MODEL = "opus";
export const DEFAULT_EFFORT = "high";

export const EFFORT_LEVELS = ["low", "medium", "high", "max"] as const;

export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export type SlashCommandTransport = "runtime" | "prompt";

export interface SlashCommand {
	command: string;
	description: string;
	transport: SlashCommandTransport;
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
	{
		command: "new",
		description: "Start a new conversation",
		transport: "runtime",
	},
	{
		command: "model",
		description: "Switch model (opus/sonnet/haiku)",
		transport: "runtime",
	},
	{
		command: "thinking",
		description: "Set thinking effort (low/medium/high/max)",
		transport: "runtime",
	},
	{
		command: "session",
		description: "Show/list/switch sessions",
		transport: "runtime",
	},
	{
		command: "status",
		description: "Show model, effort, and context usage",
		transport: "runtime",
	},
	{
		command: "stop",
		description: "Cancel the current agent run",
		transport: "runtime",
	},
	{
		command: "restart",
		description: "Restart the daemon",
		transport: "runtime",
	},
	{
		command: "compact",
		description: "Compact conversation context",
		transport: "prompt",
	},
];

export const PROMPT_COMMANDS = SLASH_COMMANDS.filter(
	(command) => command.transport === "prompt",
);

const MODEL_ALIAS_COMMAND_SET = new Set(
	MODEL_ALIAS_LIST.map((alias) => `/${alias}`),
);

const RUNTIME_COMMAND_SET = new Set(
	SLASH_COMMANDS.filter((c) => c.transport === "runtime").map((c) => c.command),
);

const PROMPT_COMMAND_SET = new Set(
	SLASH_COMMANDS.filter((c) => c.transport === "prompt").map((c) => c.command),
);

export const RUNTIME_COMMANDS = SLASH_COMMANDS.filter(
	(c) => c.transport === "runtime",
);

export function findSlashCommand(input: string): SlashCommand | undefined {
	const trimmed = input.trim();
	if (!trimmed.startsWith("/")) {
		return undefined;
	}

	const bare = trimmed.split(" ")[0]?.slice(1) ?? "";
	return SLASH_COMMANDS.find((command) => command.command === bare);
}

export function canonicalizePromptSlashCommand(
	input: string,
): string | undefined {
	const trimmed = input.trim();
	const command = findSlashCommand(trimmed);
	if (!command || command.transport !== "prompt") {
		return undefined;
	}

	return trimmed === `/${command.command}` ? trimmed : undefined;
}

export function isEffortLevel(value: string): value is EffortLevel {
	return EFFORT_LEVELS.includes(value as EffortLevel);
}

export function isRuntimeCommand(input: string): boolean {
	const trimmed = input.trim();
	if (!trimmed.startsWith("/")) {
		return false;
	}

	const bare = trimmed.split(" ")[0]?.slice(1) ?? "";
	if (RUNTIME_COMMAND_SET.has(bare)) return true;
	if (MODEL_ALIAS_COMMAND_SET.has(trimmed)) return true;

	return false;
}

export function isPromptSlashCommand(input: string): boolean {
	return PROMPT_COMMAND_SET.has(findSlashCommand(input)?.command ?? "");
}
