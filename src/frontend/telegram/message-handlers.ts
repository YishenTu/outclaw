import type { handleTelegramRuntimeTextCommand } from "./commands/runtime.ts";
import type { TelegramMessageFileRecord } from "./files/message-file-ref.ts";
import type { handleTelegramMemoryTextCommand } from "./memory/register.ts";
import type { handleTelegramDocumentMessage } from "./messages/document.ts";
import type { handleTelegramPhotoMessage } from "./messages/photo.ts";
import type { handleTelegramTextMessage } from "./messages/text.ts";
import type { handleTelegramVoiceMessage } from "./messages/voice.ts";
import type { TelegramBridgeFactory } from "./routing.ts";

type TelegramTextHandlerContext = Parameters<
	typeof handleTelegramTextMessage
>[0];
type TelegramPhotoHandlerContext = Parameters<
	typeof handleTelegramPhotoMessage
>[0];
type TelegramDocumentHandlerContext = Parameters<
	typeof handleTelegramDocumentMessage
>[0];
type TelegramVoiceHandlerContext = Parameters<
	typeof handleTelegramVoiceMessage
>[0];
type TelegramTextMessageOptions = Parameters<
	typeof handleTelegramTextMessage
>[1];
type TelegramPhotoMessageOptions = Parameters<
	typeof handleTelegramPhotoMessage
>[1];
type TelegramDocumentMessageOptions = Parameters<
	typeof handleTelegramDocumentMessage
>[1];
type TelegramVoiceMessageOptions = Parameters<
	typeof handleTelegramVoiceMessage
>[1];

export interface TelegramIncomingTextContext {
	chat: TelegramTextHandlerContext["chat"];
	from?: { id: number };
	message: TelegramTextHandlerContext["message"];
	reply: TelegramTextHandlerContext["reply"];
	replyWithChatAction: TelegramTextHandlerContext["replyWithChatAction"];
	replyWithPhoto: TelegramTextHandlerContext["replyWithPhoto"];
}

export interface TelegramIncomingPhotoContext {
	api: {
		getFile(fileId: string): Promise<{ file_path?: string }>;
	};
	chat: TelegramPhotoHandlerContext["chat"];
	from?: { id: number };
	message: TelegramPhotoHandlerContext["message"];
	reply: TelegramPhotoHandlerContext["reply"];
	replyWithChatAction: TelegramPhotoHandlerContext["replyWithChatAction"];
	replyWithPhoto: TelegramPhotoHandlerContext["replyWithPhoto"];
}

export interface TelegramIncomingDocumentContext {
	api: {
		getFile(fileId: string): Promise<{ file_path?: string }>;
	};
	chat: TelegramDocumentHandlerContext["chat"];
	from?: { id: number };
	message: TelegramDocumentHandlerContext["message"];
	reply: TelegramDocumentHandlerContext["reply"];
	replyWithChatAction: TelegramDocumentHandlerContext["replyWithChatAction"];
	replyWithPhoto: TelegramDocumentHandlerContext["replyWithPhoto"];
}

export interface TelegramIncomingVoiceContext {
	api: {
		getFile(fileId: string): Promise<{ file_path?: string }>;
	};
	chat: TelegramVoiceHandlerContext["chat"];
	from?: { id: number };
	message: TelegramVoiceHandlerContext["message"];
	reply: TelegramVoiceHandlerContext["reply"];
	replyWithChatAction: TelegramVoiceHandlerContext["replyWithChatAction"];
	replyWithPhoto: TelegramVoiceHandlerContext["replyWithPhoto"];
}

export interface TelegramMessageRegistrar {
	readonly api: {
		sendMessage(
			chatId: number,
			text: string,
			options?: object,
		): Promise<{ message_id: number }>;
		editMessageText(
			chatId: number,
			messageId: number,
			text: string,
			options?: object,
		): Promise<unknown>;
	};
	on(
		event: "message:text",
		handler: (ctx: TelegramIncomingTextContext) => Promise<void>,
	): unknown;
	on(
		event: "message:photo",
		handler: (ctx: TelegramIncomingPhotoContext) => Promise<void>,
	): unknown;
	on(
		event: "message:document",
		handler: (ctx: TelegramIncomingDocumentContext) => Promise<void>,
	): unknown;
	on(
		event: "message:voice",
		handler: (ctx: TelegramIncomingVoiceContext) => Promise<void>,
	): unknown;
	on(
		event: "message:audio",
		handler: (ctx: TelegramIncomingVoiceContext) => Promise<void>,
	): unknown;
}

export interface TelegramMessageHandlerDependencies {
	handleDocumentMessage: typeof handleTelegramDocumentMessage;
	handleMemoryTextCommand: typeof handleTelegramMemoryTextCommand;
	handlePhotoMessage: typeof handleTelegramPhotoMessage;
	handleRuntimeTextCommand: typeof handleTelegramRuntimeTextCommand;
	handleTextMessage: typeof handleTelegramTextMessage;
	handleVoiceMessage: typeof handleTelegramVoiceMessage;
}

export function registerTelegramMessageHandlers(params: {
	bot: TelegramMessageRegistrar;
	createBridge: TelegramBridgeFactory;
	filesRoot: string;
	rememberMessageFile?: (record: TelegramMessageFileRecord) => Promise<void>;
	resolveMessageFile?: TelegramTextMessageOptions["resolveMessageFile"];
	token: string;
	dependencies: TelegramMessageHandlerDependencies;
}) {
	const buildPromptOptions = (ctx: {
		chat: { id: number };
		from?: { id: number };
	}): TelegramTextMessageOptions => ({
		resolveMessageFile: params.resolveMessageFile,
		rememberMessageFile: params.rememberMessageFile,
		streamPrompt: (prompt, images, onImage, replyContext) =>
			params
				.createBridge(ctx)
				.stream(prompt, images, onImage, ctx.chat.id, replyContext),
	});

	const buildMediaOptions = (ctx: {
		chat: { id: number };
		from?: { id: number };
	}) => ({
		...buildPromptOptions(ctx),
		token: params.token,
		filesRoot: params.filesRoot,
	});

	const buildPromptContext = <TMessage>(ctx: {
		chat: { id: number };
		message: TMessage;
		reply: TelegramTextHandlerContext["reply"];
		replyWithChatAction: TelegramTextHandlerContext["replyWithChatAction"];
		replyWithPhoto: TelegramTextHandlerContext["replyWithPhoto"];
	}) => ({
		chat: ctx.chat,
		message: ctx.message,
		reply: (text: string) => ctx.reply(text),
		replyWithChatAction: (
			action: Parameters<TelegramTextHandlerContext["replyWithChatAction"]>[0],
		) => ctx.replyWithChatAction(action),
		replyWithPhoto: (
			photo: Parameters<TelegramTextHandlerContext["replyWithPhoto"]>[0],
			options: Parameters<TelegramTextHandlerContext["replyWithPhoto"]>[1],
		) => ctx.replyWithPhoto(photo, options),
		sendMessage: (
			text: string,
			options: Parameters<TelegramTextHandlerContext["sendMessage"]>[1],
		) => params.bot.api.sendMessage(ctx.chat.id, text, options),
		editMessageText: (
			messageId: number,
			text: string,
			options: Parameters<TelegramTextHandlerContext["editMessageText"]>[2],
		) => params.bot.api.editMessageText(ctx.chat.id, messageId, text, options),
	});

	params.bot.on("message:text", async (ctx) => {
		if (
			await params.dependencies.handleMemoryTextCommand(
				ctx,
				params.createBridge,
			)
		) {
			return;
		}
		if (
			await params.dependencies.handleRuntimeTextCommand(
				ctx,
				params.createBridge,
			)
		) {
			return;
		}

		await params.dependencies.handleTextMessage(
			buildPromptContext(ctx),
			buildPromptOptions(ctx),
		);
	});

	params.bot.on("message:photo", async (ctx) => {
		const largestPhoto = ctx.message.photo.at(-1);
		if (!largestPhoto) {
			await ctx.reply("[error] Telegram photo message is missing photo sizes");
			return;
		}

		await params.dependencies.handlePhotoMessage(
			{
				...buildPromptContext(ctx),
				getFile: () => ctx.api.getFile(largestPhoto.file_id),
			},
			buildMediaOptions(ctx) as TelegramPhotoMessageOptions,
		);
	});

	params.bot.on("message:document", async (ctx) => {
		await params.dependencies.handleDocumentMessage(
			{
				...buildPromptContext(ctx),
				getFile: () => ctx.api.getFile(ctx.message.document.file_id),
			},
			buildMediaOptions(ctx) as TelegramDocumentMessageOptions,
		);
	});

	params.bot.on("message:voice", async (ctx) => {
		const voice = ctx.message.voice;
		if (!voice) {
			await ctx.reply(
				"[error] Telegram voice message is missing audio payload",
			);
			return;
		}

		await params.dependencies.handleVoiceMessage(
			{
				...buildPromptContext(ctx),
				getFile: () => ctx.api.getFile(voice.file_id),
			},
			buildMediaOptions(ctx) as TelegramVoiceMessageOptions,
		);
	});

	params.bot.on("message:audio", async (ctx) => {
		const audio = ctx.message.audio;
		if (!audio) {
			await ctx.reply(
				"[error] Telegram audio message is missing audio payload",
			);
			return;
		}

		await params.dependencies.handleVoiceMessage(
			{
				...buildPromptContext(ctx),
				getFile: () => ctx.api.getFile(audio.file_id),
			},
			buildMediaOptions(ctx) as TelegramVoiceMessageOptions,
		);
	});
}
