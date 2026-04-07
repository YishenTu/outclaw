import type { InputFile } from "grammy";
import {
	extractError,
	type ImageEvent,
	type ImageRef,
} from "../../common/protocol.ts";
import { getImageInfo } from "./image-info.ts";
import { saveTelegramMedia } from "./media.ts";
import {
	rememberOutboundImage,
	resolveReplyImages,
	type TelegramMessageImageOptions,
} from "./message-image-ref.ts";
import { runTelegramPrompt } from "./run-prompt.ts";

interface TelegramPhotoContext {
	chat: { id: number };
	getFile(): Promise<{ file_path?: string }>;
	message: {
		caption?: string;
		message_id: number;
		photo: Array<{ file_id: string }>;
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

interface TelegramPhotoMessageOptions extends TelegramMessageImageOptions {
	token: string;
	mediaRoot?: string;
	saveMedia?: (
		url: string,
		ext: string,
		mediaType: ImageRef["mediaType"],
	) => Promise<ImageRef>;
	streamPrompt(
		prompt: string,
		images?: ImageRef[],
		onImage?: (event: ImageEvent) => void | Promise<void>,
	): AsyncIterable<string>;
}

export async function handleTelegramPhotoMessage(
	ctx: TelegramPhotoContext,
	options: TelegramPhotoMessageOptions,
) {
	try {
		if (ctx.message.photo.length === 0) {
			throw new Error("Telegram photo message is missing photo sizes");
		}

		const file = await ctx.getFile();
		if (!file.file_path) {
			throw new Error("Telegram file path is missing");
		}

		const { ext, mediaType } = getImageInfo(file.file_path);
		const saveMedia =
			options.saveMedia ??
			((
				url: string,
				extension: string,
				imageMediaType: ImageRef["mediaType"],
			) => {
				if (!options.mediaRoot) {
					throw new Error("Telegram media root is not configured");
				}
				return saveTelegramMedia(
					options.mediaRoot,
					url,
					extension,
					imageMediaType,
				);
			});
		const image = await saveMedia(
			buildTelegramFileUrl(options.token, file.file_path),
			ext,
			mediaType,
		);
		await options.rememberMessageImage?.({
			chatId: ctx.chat.id,
			messageId: ctx.message.message_id,
			image,
			direction: "inbound",
		});
		const replyImages = await resolveReplyImages(
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
				prompt: ctx.message.caption ?? "",
				images: [...replyImages, image],
				rememberSentImage: async (messageId, event) => {
					await rememberOutboundImage(
						ctx.chat.id,
						messageId,
						event,
						options.rememberMessageImage,
					);
				},
				streamPrompt: (prompt, images, onImage) =>
					options.streamPrompt(prompt, images, onImage),
			},
		);
	} catch (err) {
		await ctx.reply(`[error] ${extractError(err)}`);
	}
}

function buildTelegramFileUrl(token: string, filePath: string): string {
	return `https://api.telegram.org/file/bot${token}/${filePath}`;
}
