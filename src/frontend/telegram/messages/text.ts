import type { InputFile } from "grammy";
import {
	extractError,
	type ImageEvent,
	type ImageRef,
} from "../../../common/protocol.ts";
import type { StreamChunk } from "../bridge/client.ts";
import {
	rememberOutboundImage,
	resolveReplyImages,
	type TelegramMessageImageOptions,
} from "../media/message-image-ref.ts";
import { runTelegramPrompt } from "./prompt.ts";
import { extractReplyContext } from "./reply-context.ts";

interface TelegramTextContext {
	chat: { id: number };
	message: {
		text: string;
		message_id: number;
		reply_to_message?: { message_id: number; text?: string; caption?: string };
	};
	reply(text: string): Promise<unknown>;
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

interface TelegramTextMessageOptions extends TelegramMessageImageOptions {
	streamPrompt(
		prompt: string,
		images?: ImageRef[],
		onImage?: (event: ImageEvent) => void | Promise<void>,
		replyContext?: { text: string },
	): AsyncIterable<StreamChunk>;
}

export async function handleTelegramTextMessage(
	ctx: TelegramTextContext,
	options: TelegramTextMessageOptions,
) {
	try {
		const images = await resolveReplyImages(
			ctx.chat.id,
			ctx.message.reply_to_message,
			options.resolveMessageImage,
		);

		await runTelegramPrompt(
			{
				chatId: ctx.chat.id,
				replyWithChatAction: (action) => ctx.replyWithChatAction(action),
				replyWithPhoto: (photo, promptOptions) =>
					ctx.replyWithPhoto(photo, promptOptions),
				sendMessage: (text, sendOptions) => ctx.sendMessage(text, sendOptions),
				editMessageText: (messageId, text, editOptions) =>
					ctx.editMessageText(messageId, text, editOptions),
			},
			{
				prompt: ctx.message.text,
				images,
				replyContext: extractReplyContext(ctx.message.reply_to_message),
				rememberSentImage: async (messageId, event) => {
					await rememberOutboundImage(
						ctx.chat.id,
						messageId,
						event,
						options.rememberMessageImage,
					);
				},
				streamPrompt: (prompt, promptImages, onImage, replyContext) =>
					options.streamPrompt(prompt, promptImages, onImage, replyContext),
			},
		);
	} catch (err) {
		await ctx.reply(`[error] ${extractError(err)}`);
	}
}
