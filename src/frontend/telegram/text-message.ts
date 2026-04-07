import type { InputFile } from "grammy";
import {
	extractError,
	type ImageEvent,
	type ImageRef,
} from "../../common/protocol.ts";
import {
	rememberOutboundImage,
	resolveReplyImages,
	type TelegramMessageImageOptions,
} from "./message-image-ref.ts";
import { runTelegramPrompt } from "./run-prompt.ts";

interface TelegramTextContext {
	chat: { id: number };
	message: {
		text: string;
		message_id: number;
		reply_to_message?: { message_id: number };
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
	replyWithStream(
		iterable: AsyncIterable<string>,
		placeholder: undefined,
		options: {
			disable_notification: boolean;
		},
	): Promise<unknown>;
}

interface TelegramTextMessageOptions extends TelegramMessageImageOptions {
	streamPrompt(
		prompt: string,
		images?: ImageRef[],
		onImage?: (event: ImageEvent) => void | Promise<void>,
	): AsyncIterable<string>;
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
				replyWithChatAction: (action) => ctx.replyWithChatAction(action),
				replyWithPhoto: (photo, promptOptions) =>
					ctx.replyWithPhoto(photo, promptOptions),
				replyWithStream: (iterable, placeholder, promptOptions) =>
					ctx.replyWithStream(iterable, placeholder, promptOptions),
			},
			{
				prompt: ctx.message.text,
				images,
				rememberSentImage: async (messageId, event) => {
					await rememberOutboundImage(
						ctx.chat.id,
						messageId,
						event,
						options.rememberMessageImage,
					);
				},
				streamPrompt: (prompt, promptImages, onImage) =>
					options.streamPrompt(prompt, promptImages, onImage),
			},
		);
	} catch (err) {
		await ctx.reply(`[error] ${extractError(err)}`);
	}
}
