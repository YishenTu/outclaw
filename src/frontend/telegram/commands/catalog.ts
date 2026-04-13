import type { BotCommand } from "grammy/types";
import { TELEGRAM_PROMPT_COMMANDS } from "./prompt.ts";
import { TELEGRAM_COMMANDS as RUNTIME_TELEGRAM_COMMANDS } from "./runtime.ts";

export const TELEGRAM_COMMANDS: BotCommand[] = [
	...RUNTIME_TELEGRAM_COMMANDS,
	...TELEGRAM_PROMPT_COMMANDS,
];
