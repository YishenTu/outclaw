import type { BotCommand } from "grammy/types";

export const TELEGRAM_COMMANDS: BotCommand[] = [
	{ command: "new", description: "Start a new conversation" },
	{ command: "model", description: "Switch model (opus/sonnet/haiku)" },
	{
		command: "thinking",
		description: "Set thinking effort (low/medium/high/max)",
	},
	{ command: "session", description: "Show/list/switch sessions" },
	{ command: "status", description: "Show model, effort, and context usage" },
];
