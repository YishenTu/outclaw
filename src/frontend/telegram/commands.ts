import type { BotCommand } from "grammy/types";
import { RUNTIME_COMMANDS } from "../../common/commands.ts";

export const TELEGRAM_COMMANDS: BotCommand[] = RUNTIME_COMMANDS.map(
	(command) => ({
		command: command.command,
		description: command.description,
	}),
);
