import { RUNTIME_COMMANDS } from "../../../common/commands.ts";

interface TelegramCommandEvent {
	type: string;
	[key: string]: unknown;
}

export interface TelegramRuntimeCommandBridge {
	sendCommandAndWait(
		command: string,
		expectedTypes?: ReadonlySet<string>,
	): Promise<TelegramCommandEvent>;
}

interface TelegramCommandContext {
	match?: string;
	reply(text: string): Promise<unknown>;
}

interface TelegramCommandRegistrar {
	command(
		command: string,
		handler: (ctx: TelegramCommandContext) => Promise<void>,
	): unknown;
}

type TelegramRuntimeCommandName =
	| "new"
	| "model"
	| "thinking"
	| "status"
	| "stop";

type TelegramCommandName = TelegramRuntimeCommandName | "session";

interface TelegramRuntimeCommandDefinition {
	buildCommand(match?: string): string;
	expectedTypes: ReadonlySet<string>;
	formatReply(event: TelegramCommandEvent): string | undefined;
}

const COMMAND_DESCRIPTIONS = new Map(
	RUNTIME_COMMANDS.map((command) => [command.command, command.description]),
);

function getCommandDescription(command: TelegramCommandName): string {
	const description = COMMAND_DESCRIPTIONS.get(command);
	if (!description) {
		throw new Error(`Missing description for Telegram command: ${command}`);
	}
	return description;
}

function formatError(event: TelegramCommandEvent): string | undefined {
	return event.type === "error"
		? `[error] ${String(event.message ?? "")}`
		: undefined;
}

const TELEGRAM_RUNTIME_COMMAND_DEFINITIONS: Record<
	TelegramRuntimeCommandName,
	TelegramRuntimeCommandDefinition
> = {
	new: {
		buildCommand: () => "/new",
		expectedTypes: new Set(["session_cleared"]),
		formatReply: (event) =>
			event.type === "session_cleared"
				? "Session cleared. Starting fresh."
				: formatError(event),
	},
	model: {
		buildCommand: (match) => (match ? `/model ${match}` : "/model"),
		expectedTypes: new Set(["model_changed"]),
		formatReply: (event) =>
			event.type === "model_changed"
				? `Model: ${String(event.model)}`
				: formatError(event),
	},
	thinking: {
		buildCommand: (match) => (match ? `/thinking ${match}` : "/thinking"),
		expectedTypes: new Set(["effort_changed"]),
		formatReply: (event) =>
			event.type === "effort_changed"
				? `Thinking effort: ${String(event.effort)}`
				: formatError(event),
	},
	status: {
		buildCommand: () => "/status",
		expectedTypes: new Set(["runtime_status"]),
		formatReply: (event) => {
			if (event.type !== "runtime_status") {
				return formatError(event);
			}
			const usage = event.usage as
				| { contextTokens: number; contextWindow: number; percentage: number }
				| undefined;
			const contextInfo = usage
				? `${usage.contextTokens.toLocaleString()}/${usage.contextWindow.toLocaleString()} (${usage.percentage}%)`
				: "n/a";
			return `Model: ${String(event.model)}\nEffort: ${String(event.effort)}\nSession: ${String(event.sessionId ?? "none")}\nContext: ${contextInfo}`;
		},
	},
	stop: {
		buildCommand: () => "/stop",
		expectedTypes: new Set(["status"]),
		formatReply: (event) =>
			event.type === "status" ? String(event.message) : formatError(event),
	},
};

export const TELEGRAM_RUNTIME_COMMAND_NAMES = Object.keys(
	TELEGRAM_RUNTIME_COMMAND_DEFINITIONS,
) as TelegramRuntimeCommandName[];

export async function executeTelegramRuntimeCommand(
	command: TelegramRuntimeCommandName,
	bridge: TelegramRuntimeCommandBridge,
	match?: string,
): Promise<string | undefined> {
	const definition = TELEGRAM_RUNTIME_COMMAND_DEFINITIONS[command];
	const event = await bridge.sendCommandAndWait(
		definition.buildCommand(match?.trim()),
		definition.expectedTypes,
	);
	return definition.formatReply(event);
}

export function registerTelegramRuntimeCommands(
	registrar: TelegramCommandRegistrar,
	bridge: TelegramRuntimeCommandBridge,
) {
	for (const command of TELEGRAM_RUNTIME_COMMAND_NAMES) {
		registrar.command(command, async (ctx) => {
			const reply = await executeTelegramRuntimeCommand(
				command,
				bridge,
				ctx.match,
			);
			if (reply) {
				await ctx.reply(reply);
			}
		});
	}
}

export const TELEGRAM_COMMANDS = [
	...TELEGRAM_RUNTIME_COMMAND_NAMES.map((command) => ({
		command,
		description: getCommandDescription(command),
	})),
	{ command: "session", description: getCommandDescription("session") },
];
