import type { BotCommand } from "grammy/types";

export const TELEGRAM_COMMANDS: BotCommand[] = [
	{ command: "new", description: "Start a new conversation" },
	{ command: "model", description: "Switch model (opus/sonnet/haiku)" },
	{ command: "opus", description: "Switch to Opus" },
	{ command: "sonnet", description: "Switch to Sonnet" },
	{ command: "haiku", description: "Switch to Haiku" },
	{
		command: "thinking",
		description: "Set thinking effort (low/medium/high/max)",
	},
];
