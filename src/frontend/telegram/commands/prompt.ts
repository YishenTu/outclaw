import type { BotCommand } from "grammy/types";
import { PROMPT_COMMANDS } from "../../../common/commands.ts";
import type {
	ImageEvent,
	ImageRef,
	ReplyContext,
} from "../../../common/protocol.ts";
import type { StreamChunk } from "../bridge/client.ts";
import { runTelegramPrompt } from "../messages/prompt.ts";

interface TelegramPromptCommandContext {
	chat: { id: number };
	replyWithChatAction(action: "typing"): Promise<unknown>;
	replyWithPhoto(
		photo: unknown,
		options: { caption?: string; disable_notification: boolean },
	): Promise<{ message_id: number }>;
	sendMessage(
		text: string,
		options: { parse_mode?: string; disable_notification?: boolean },
	): Promise<{ message_id: number }>;
	editMessageText(
		messageId: number,
		text: string,
		options: { parse_mode?: string },
	): Promise<unknown>;
}

interface TelegramPromptCommandRegistrar {
	command(
		command: string,
		handler: (ctx: TelegramPromptCommandContext) => Promise<void>,
	): unknown;
}

export interface TelegramPromptCommandBridge {
	stream(
		prompt: string,
		images?: ImageRef[],
		onImage?: (event: ImageEvent) => void | Promise<void>,
		telegramChatId?: number,
		replyContext?: ReplyContext,
	): AsyncIterable<StreamChunk>;
}

export const TELEGRAM_PROMPT_COMMANDS: BotCommand[] = PROMPT_COMMANDS.map(
	(command) => ({
		command: command.command,
		description: command.description,
	}),
);

export function registerTelegramPromptCommands(
	registrar: TelegramPromptCommandRegistrar,
	bridge: TelegramPromptCommandBridge,
) {
	for (const command of PROMPT_COMMANDS) {
		registrar.command(command.command, async (ctx) => {
			await runTelegramPrompt(
				{
					chatId: ctx.chat.id,
					replyWithChatAction: (action) => ctx.replyWithChatAction(action),
					replyWithPhoto: (photo, options) =>
						ctx.replyWithPhoto(photo, options),
					sendMessage: (text, options) => ctx.sendMessage(text, options),
					editMessageText: (messageId, text, options) =>
						ctx.editMessageText(messageId, text, options),
				},
				{
					prompt: `/${command.command}`,
					streamPrompt: (prompt, images, onImage, replyContext) =>
						bridge.stream(prompt, images, onImage, ctx.chat.id, replyContext),
				},
			);
		});
	}
}
