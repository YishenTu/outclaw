import type { InputFile } from "grammy";
import {
	extractError,
	type ImageEvent,
	type ImageRef,
} from "../../../common/protocol.ts";
import type { StreamChunk } from "../bridge/client.ts";
import { getImageInfo } from "../files/image-info.ts";
import {
	appendPromptSegments,
	rememberOutboundImage,
	resolveReplyAttachments,
	type TelegramMessageFileOptions,
} from "../files/message-file-ref.ts";
import { saveTelegramFile } from "../files/storage.ts";
import { runTelegramPrompt } from "./prompt.ts";
import { extractReplyContext } from "./reply-context.ts";

interface TelegramPhotoContext {
	chat: { id: number };
	getFile(): Promise<{ file_path?: string }>;
	message: {
		caption?: string;
		message_id: number;
		photo: Array<{ file_id: string }>;
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

interface TelegramPhotoMessageOptions extends TelegramMessageFileOptions {
	token: string;
	filesRoot?: string;
	saveMedia?: (
		url: string,
		ext: string,
		mediaType: ImageRef["mediaType"],
	) => Promise<ImageRef>;
	streamPrompt(
		prompt: string,
		images?: ImageRef[],
		onImage?: (event: ImageEvent) => void | Promise<void>,
		replyContext?: { text: string },
	): AsyncIterable<StreamChunk>;
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
			(async (
				url: string,
				extension: string,
				imageMediaType: ImageRef["mediaType"],
			): Promise<ImageRef> => {
				if (!options.filesRoot) {
					throw new Error("Telegram files root is not configured");
				}
				const saved = await saveTelegramFile(options.filesRoot, url, extension);
				return { path: saved.path, mediaType: imageMediaType };
			});
		const image = await saveMedia(
			buildTelegramFileUrl(options.token, file.file_path),
			ext,
			mediaType,
		);
		await options.rememberMessageFile?.({
			chatId: ctx.chat.id,
			messageId: ctx.message.message_id,
			file: {
				kind: "image",
				image,
			},
			direction: "inbound",
		});
		const replyAttachments = await resolveReplyAttachments(
			ctx.chat.id,
			ctx.message.reply_to_message,
			options.resolveMessageFile,
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
				prompt: appendPromptSegments(
					ctx.message.caption ?? "",
					replyAttachments.promptSegments,
				),
				images: [...replyAttachments.images, image],
				replyContext: extractReplyContext(ctx.message.reply_to_message),
				rememberSentImage: async (messageId, event) => {
					await rememberOutboundImage(
						ctx.chat.id,
						messageId,
						event,
						options.rememberMessageFile,
					);
				},
				streamPrompt: (prompt, images, onImage, replyContext) =>
					options.streamPrompt(prompt, images, onImage, replyContext),
			},
		);
	} catch (err) {
		await ctx.reply(`[error] ${extractError(err)}`);
	}
}

function buildTelegramFileUrl(token: string, filePath: string): string {
	return `https://api.telegram.org/file/bot${token}/${filePath}`;
}
