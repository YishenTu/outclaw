import type { InputFile } from "grammy";
import {
	extractError,
	type ImageEvent,
	type ImageRef,
} from "../../../common/protocol.ts";
import type { StreamChunk } from "../bridge/client.ts";
import {
	appendPromptSegments,
	formatTelegramVoicePromptRef,
	rememberOutboundImage,
	resolveReplyAttachments,
	type TelegramMessageFileOptions,
} from "../files/message-file-ref.ts";
import { saveTelegramFile } from "../files/storage.ts";
import { runTelegramPrompt } from "./prompt.ts";
import { extractReplyContext } from "./reply-context.ts";

const DEFAULT_MAX_VOICE_BYTES = 20 * 1024 * 1024;

interface TelegramVoiceContext {
	chat: { id: number };
	getFile(): Promise<{ file_path?: string }>;
	message: {
		message_id: number;
		reply_to_message?: { message_id: number; text?: string; caption?: string };
		voice?: {
			file_id: string;
			file_size?: number;
			mime_type?: string;
			duration?: number;
		};
		audio?: {
			file_id: string;
			file_name?: string;
			file_size?: number;
			mime_type?: string;
			duration?: number;
			caption?: string;
		};
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

interface TelegramVoiceMessageOptions extends TelegramMessageFileOptions {
	token: string;
	filesRoot?: string;
	maxVoiceBytes?: number;
	streamPrompt(
		prompt: string,
		images?: ImageRef[],
		onImage?: (event: ImageEvent) => void | Promise<void>,
		replyContext?: { text: string },
	): AsyncIterable<StreamChunk>;
}

interface TelegramAudioSource {
	caption?: string;
	defaultExtension: string;
	durationSeconds?: number;
	fileId: string;
	fileName?: string;
	fileSize?: number;
	mimeType?: string;
}

export async function handleTelegramVoiceMessage(
	ctx: TelegramVoiceContext,
	options: TelegramVoiceMessageOptions,
) {
	try {
		const source = readAudioSource(ctx.message);
		if (!source) {
			throw new Error("Telegram voice message is missing audio payload");
		}

		if (source.mimeType && !source.mimeType.startsWith("audio/")) {
			throw new Error(`unsupported voice format: ${source.mimeType}`);
		}

		const maxBytes = options.maxVoiceBytes ?? DEFAULT_MAX_VOICE_BYTES;
		if ((source.fileSize ?? 0) > maxBytes) {
			throw new Error("voice note too large (20 MB limit)");
		}

		const file = await ctx.getFile();
		if (!file.file_path) {
			throw new Error("Telegram file path is missing");
		}

		if (!options.filesRoot) {
			throw new Error("Telegram files root is not configured");
		}

		const ext = resolveAudioExtension({
			defaultExtension: source.defaultExtension,
			fileName: source.fileName,
			filePath: file.file_path,
			mimeType: source.mimeType,
		});
		const saved = await saveTelegramFile(
			options.filesRoot,
			buildTelegramFileUrl(options.token, file.file_path),
			ext,
		);

		const voiceFile = {
			kind: "voice" as const,
			voice: {
				path: saved.path,
				durationSeconds: source.durationSeconds,
				mimeType: source.mimeType,
			},
		};
		await options.rememberMessageFile?.({
			chatId: ctx.chat.id,
			messageId: ctx.message.message_id,
			file: voiceFile,
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
				prompt: appendPromptSegments(source.caption ?? "", [
					...replyAttachments.promptSegments,
					formatTelegramVoicePromptRef(voiceFile.voice),
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
				streamPrompt: (prompt, images, onImage, replyContext) =>
					options.streamPrompt(prompt, images, onImage, replyContext),
			},
		);
	} catch (err) {
		await ctx.reply(`[error] ${extractError(err)}`);
	}
}

function readAudioSource(
	message: TelegramVoiceContext["message"],
): TelegramAudioSource | undefined {
	if (message.voice) {
		return {
			defaultExtension: ".oga",
			durationSeconds: message.voice.duration,
			fileId: message.voice.file_id,
			fileSize: message.voice.file_size,
			mimeType: message.voice.mime_type,
		};
	}

	if (message.audio) {
		return {
			caption: message.audio.caption,
			defaultExtension: ".bin",
			durationSeconds: message.audio.duration,
			fileId: message.audio.file_id,
			fileName: message.audio.file_name,
			fileSize: message.audio.file_size,
			mimeType: message.audio.mime_type,
		};
	}

	return undefined;
}

function buildTelegramFileUrl(token: string, filePath: string): string {
	return `https://api.telegram.org/file/bot${token}/${filePath}`;
}

function resolveAudioExtension(params: {
	defaultExtension: string;
	fileName?: string;
	filePath?: string;
	mimeType?: string;
}): string {
	const fromMime = canonicalAudioExtension(params.mimeType);
	if (fromMime) {
		return fromMime;
	}

	const fromName = extFromPath(params.fileName);
	if (fromName) {
		return fromName;
	}

	const fromPath = extFromPath(params.filePath);
	if (fromPath) {
		return fromPath;
	}

	return params.defaultExtension;
}

function canonicalAudioExtension(mimeType?: string): string | undefined {
	switch (mimeType?.toLowerCase()) {
		case "audio/ogg":
			return ".oga";
		case "audio/mpeg":
			return ".mp3";
		case "audio/mp4":
		case "audio/x-m4a":
			return ".m4a";
		case "audio/aac":
			return ".aac";
		case "audio/wav":
		case "audio/wave":
		case "audio/x-wav":
			return ".wav";
		case "audio/flac":
			return ".flac";
		default:
			return undefined;
	}
}

function extFromPath(filePath?: string): string | undefined {
	if (!filePath) {
		return undefined;
	}

	const dot = filePath.lastIndexOf(".");
	if (dot === -1 || dot === filePath.length - 1) {
		return undefined;
	}

	return filePath.slice(dot).toLowerCase();
}
