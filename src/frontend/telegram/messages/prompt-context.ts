import type { InputFile } from "grammy";
import type { TelegramPromptContext } from "./prompt.ts";

interface TelegramPromptSourceContext {
	chat: { id: number };
	replyWithChatAction(action: "typing"): Promise<unknown>;
	replyWithPhoto(
		photo: InputFile,
		options: {
			caption?: string;
			disable_notification: boolean;
		},
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

export function createTelegramPromptContext(
	ctx: TelegramPromptSourceContext,
): TelegramPromptContext {
	return {
		chatId: ctx.chat.id,
		replyWithChatAction: (action) => ctx.replyWithChatAction(action),
		replyWithPhoto: (photo, options) => ctx.replyWithPhoto(photo, options),
		sendMessage: (text, options) => ctx.sendMessage(text, options),
		editMessageText: (messageId, text, options) =>
			ctx.editMessageText(messageId, text, options),
	};
}
