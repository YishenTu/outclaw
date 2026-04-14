import { RUNTIME_COMMANDS } from "../../../common/commands.ts";
import type { RuntimeStatusEvent } from "../../../common/protocol.ts";
import { formatStatusCompact } from "../../../common/status.ts";

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
	from?: { id: number };
	match?: string;
	reply(text: string): Promise<unknown>;
}

type TelegramRuntimeCommandBridgeFactory = (
	ctx: TelegramCommandContext,
) => TelegramRuntimeCommandBridge;

interface TelegramCommandRegistrar {
	command(
		command: string,
		handler: (ctx: TelegramCommandContext) => Promise<void>,
	): unknown;
}

type TelegramRuntimeCommandName =
	| "agent"
	| "new"
	| "model"
	| "thinking"
	| "status"
	| "stop"
	| "restart";

type TelegramCommandName = TelegramRuntimeCommandName | "session";

interface TelegramRuntimeCommandDefinition {
	buildCommand(match?: string): string;
	expectedTypes(match?: string): ReadonlySet<string>;
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
	agent: {
		buildCommand: (match) => (match ? `/agent ${match}` : "/agent"),
		expectedTypes: (match) =>
			match ? new Set(["agent_switched"]) : new Set(["agent_menu"]),
		formatReply: (event) => {
			if (event.type === "agent_switched") {
				return `Current agent: ${String(event.name)}`;
			}
			if (event.type !== "agent_menu") {
				return formatError(event);
			}

			const activeAgentId = String(event.activeAgentId);
			const agents = Array.isArray(event.agents) ? event.agents : [];
			const lines = ["Agents"];
			for (const agent of agents) {
				const item =
					agent &&
					typeof agent === "object" &&
					"name" in agent &&
					"agentId" in agent
						? {
								agentId: String(agent.agentId),
								name: String(agent.name),
							}
						: undefined;
				if (!item) {
					continue;
				}
				lines.push(
					`${item.agentId === activeAgentId ? "*" : " "} ${item.name}`,
				);
			}
			return lines.join("\n");
		},
	},
	new: {
		buildCommand: () => "/new",
		expectedTypes: () => new Set(["session_cleared"]),
		formatReply: (event) =>
			event.type === "session_cleared"
				? "Session cleared. Starting fresh."
				: formatError(event),
	},
	model: {
		buildCommand: (match) => (match ? `/model ${match}` : "/model"),
		expectedTypes: () => new Set(["model_changed"]),
		formatReply: (event) =>
			event.type === "model_changed"
				? `Model: ${String(event.model)}`
				: formatError(event),
	},
	thinking: {
		buildCommand: (match) => (match ? `/thinking ${match}` : "/thinking"),
		expectedTypes: () => new Set(["effort_changed"]),
		formatReply: (event) =>
			event.type === "effort_changed"
				? `Thinking effort: ${String(event.effort)}`
				: formatError(event),
	},
	status: {
		buildCommand: () => "/status",
		expectedTypes: () => new Set(["runtime_status"]),
		formatReply: (event) => {
			if (event.type !== "runtime_status") {
				return formatError(event);
			}
			return formatStatusCompact(event as unknown as RuntimeStatusEvent);
		},
	},
	stop: {
		buildCommand: () => "/stop",
		expectedTypes: () => new Set(["status"]),
		formatReply: (event) =>
			event.type === "status" ? String(event.message) : formatError(event),
	},
	restart: {
		buildCommand: () => "/restart",
		expectedTypes: () => new Set(["status"]),
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
	const trimmedMatch = match?.trim();
	const event = await bridge.sendCommandAndWait(
		definition.buildCommand(trimmedMatch),
		definition.expectedTypes(trimmedMatch),
	);
	return definition.formatReply(event);
}

export function registerTelegramRuntimeCommands(
	registrar: TelegramCommandRegistrar,
	createBridge: TelegramRuntimeCommandBridgeFactory,
) {
	for (const command of TELEGRAM_RUNTIME_COMMAND_NAMES) {
		registrar.command(command, async (ctx) => {
			const bridge = createBridge(ctx);
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
