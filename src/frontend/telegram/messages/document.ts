import type { InputFile } from "grammy";
import {
	extractError,
	type ImageEvent,
	type ImageRef,
} from "../../../common/protocol.ts";
import type { StreamChunk } from "../bridge/client.ts";
import {
	appendPromptSegments,
	formatTelegramDocumentPromptRef,
	rememberOutboundImage,
	resolveReplyAttachments,
	type TelegramMessageFileOptions,
} from "../files/message-file-ref.ts";
import {
	basenameFromPath,
	extensionFromPath,
	saveTelegramApiFile,
} from "../files/telegram-file-path.ts";
import { runTelegramPrompt } from "./prompt.ts";
import { createTelegramPromptContext } from "./prompt-context.ts";
import { extractReplyContext } from "./reply-context.ts";

interface TelegramDocumentContext {
	chat: { id: number };
	getFile(): Promise<{ file_path?: string }>;
	message: {
		caption?: string;
		message_id: number;
		document: { file_id: string; file_name?: string };
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

interface TelegramDocumentMessageOptions extends TelegramMessageFileOptions {
	token: string;
	filesRoot?: string;
	streamPrompt(
		prompt: string,
		images?: ImageRef[],
		onImage?: (event: ImageEvent) => void | Promise<void>,
		replyContext?: { text: string },
	): AsyncIterable<StreamChunk>;
}

export async function handleTelegramDocumentMessage(
	ctx: TelegramDocumentContext,
	options: TelegramDocumentMessageOptions,
) {
	try {
		const file = await ctx.getFile();
		if (!file.file_path) {
			throw new Error("Telegram file path is missing");
		}

		const saved = await saveTelegramApiFile({
			ext: extensionFromPath(file.file_path) ?? "",
			filePath: file.file_path,
			filesRoot: options.filesRoot,
			token: options.token,
		});

		const displayName =
			ctx.message.document.file_name ?? basenameFromPath(file.file_path);
		const documentFile = {
			kind: "document" as const,
			document: {
				path: saved.path,
				displayName,
			},
		};
		await options.rememberMessageFile?.({
			chatId: ctx.chat.id,
			messageId: ctx.message.message_id,
			file: documentFile,
			direction: "inbound",
		});

		const replyAttachments = await resolveReplyAttachments(
			ctx.chat.id,
			ctx.message.reply_to_message,
			options.resolveMessageFile,
		);

		await runTelegramPrompt(createTelegramPromptContext(ctx), {
			prompt: appendPromptSegments(ctx.message.caption ?? "", [
				...replyAttachments.promptSegments,
				formatTelegramDocumentPromptRef(documentFile.document),
			]),
			images: replyAttachments.images,
			replyContext: extractReplyContext(ctx.message.reply_to_message),
			rememberSentImage: async (messageId, event) => {
				await rememberOutboundImage(
					ctx.chat.id,
					messageId,
					event,
					options.rememberMessageFile,
				);
			},
			streamPrompt: (p, imgs, onImage, replyContext) =>
				options.streamPrompt(p, imgs, onImage, replyContext),
		});
	} catch (err) {
		await ctx.reply(`[error] ${extractError(err)}`);
	}
}
