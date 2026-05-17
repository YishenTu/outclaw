export const DEFAULT_EFFORT = "medium";

export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;

export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export type SlashCommandTransport = "runtime" | "prompt";

export interface SlashCommand {
	command: string;
	description: string;
	transport: SlashCommandTransport;
}

export interface SlashCommandRoute {
	command: string;
	source: "catalog";
	transport: SlashCommandTransport;
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
	{
		command: "agent",
		description: "Show or switch agents",
		transport: "runtime",
	},
	{
		command: "new",
		description: "Start a new conversation",
		transport: "runtime",
	},
	{
		command: "model",
		description: "Switch model",
		transport: "runtime",
	},
	{
		command: "thinking",
		description: "Set thinking effort (low/medium/high/xhigh/max)",
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

const MODEL_SHORTCUT_COMMANDS = new Set(["opus", "sonnet", "haiku"]);

export const RUNTIME_COMMANDS = SLASH_COMMANDS.filter(
	(c) => c.transport === "runtime",
);

export function listSlashCommands(
	transport?: SlashCommandTransport,
): readonly SlashCommand[] {
	return transport === undefined
		? SLASH_COMMANDS
		: SLASH_COMMANDS.filter((command) => command.transport === transport);
}

export function findSlashCommand(input: string): SlashCommand | undefined {
	const trimmed = input.trim();
	if (!trimmed.startsWith("/")) {
		return undefined;
	}

	const bare = trimmed.split(" ")[0]?.slice(1) ?? "";
	return SLASH_COMMANDS.find((command) => command.command === bare);
}

export function routeSlashCommand(
	input: string,
): SlashCommandRoute | undefined {
	const trimmed = input.trim();
	if (!trimmed.startsWith("/")) {
		return undefined;
	}

	const command = findSlashCommand(trimmed);
	if (command) {
		return {
			command: command.command,
			source: "catalog",
			transport: command.transport,
		};
	}

	return undefined;
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

export function parseModelShortcutCommand(input: string): string | undefined {
	const trimmed = input.trim();
	if (!trimmed.startsWith("/") || /\s/.test(trimmed)) {
		return undefined;
	}

	const command = trimmed.slice(1);
	if (!command) {
		return undefined;
	}

	const normalized = command.toLowerCase();
	if (MODEL_SHORTCUT_COMMANDS.has(normalized)) {
		return normalized;
	}
	if (/^gpt-[a-z0-9][a-z0-9._-]*$/.test(normalized)) {
		return normalized;
	}
	return undefined;
}

export function isEffortLevel(value: string): value is EffortLevel {
	return EFFORT_LEVELS.includes(value as EffortLevel);
}

export function isRuntimeCommand(input: string): boolean {
	return (
		routeSlashCommand(input)?.transport === "runtime" ||
		parseModelShortcutCommand(input) !== undefined
	);
}

export function isPromptSlashCommand(input: string): boolean {
	return routeSlashCommand(input)?.transport === "prompt";
}
