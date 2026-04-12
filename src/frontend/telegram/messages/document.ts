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
import { saveTelegramFile } from "../files/storage.ts";
import { runTelegramPrompt } from "./prompt.ts";
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

		if (!options.filesRoot) {
			throw new Error("Telegram files root is not configured");
		}

		const ext = extFromPath(file.file_path);
		const saved = await saveTelegramFile(
			options.filesRoot,
			buildTelegramFileUrl(options.token, file.file_path),
			ext,
		);

		const displayName =
			ctx.message.document.file_name ?? basename(file.file_path);
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
			},
		);
	} catch (err) {
		await ctx.reply(`[error] ${extractError(err)}`);
	}
}

function buildTelegramFileUrl(token: string, filePath: string): string {
	return `https://api.telegram.org/file/bot${token}/${filePath}`;
}

function extFromPath(filePath: string): string {
	const dot = filePath.lastIndexOf(".");
	return dot >= 0 ? filePath.slice(dot) : "";
}

function basename(filePath: string): string {
	const slash = filePath.lastIndexOf("/");
	return slash >= 0 ? filePath.slice(slash + 1) : filePath;
}
