import { autoRetry } from "@grammyjs/auto-retry";
import { Bot, type Context, InputFile } from "grammy";
import type { ImageRef, ReplyContext } from "../../common/protocol.ts";
import { extractError } from "../../common/protocol.ts";
import { createTelegramBridge, type StreamChunk } from "./bridge/client.ts";
import { TELEGRAM_COMMANDS } from "./commands/catalog.ts";
import { registerTelegramPromptCommands } from "./commands/prompt.ts";
import { registerTelegramRuntimeCommands } from "./commands/runtime.ts";
import { registerTelegramModelShortcuts } from "./commands/shortcuts.ts";
import type {
	TelegramMessageFile,
	TelegramMessageFileRecord,
} from "./files/message-file-ref.ts";
import {
	markdownToTelegramHtml,
	splitTelegramHtml,
	TELEGRAM_MESSAGE_LIMIT,
} from "./format.ts";
import { handleTelegramDocumentMessage } from "./messages/document.ts";
import { sendTelegramHeartbeatResult } from "./messages/heartbeat-result.ts";
import { handleTelegramPhotoMessage } from "./messages/photo.ts";
import { handleTelegramTextMessage } from "./messages/text.ts";
import { registerTelegramSessionHandlers } from "./sessions/register.ts";

type MyContext = Context;
type TelegramTextHandlerContext = Parameters<
	typeof handleTelegramTextMessage
>[0];
type TelegramPhotoHandlerContext = Parameters<
	typeof handleTelegramPhotoMessage
>[0];
type TelegramDocumentHandlerContext = Parameters<
	typeof handleTelegramDocumentMessage
>[0];
type TelegramPromptStream = Parameters<
	typeof handleTelegramTextMessage
>[1]["streamPrompt"];
type TelegramImageEvent = Parameters<
	NonNullable<Parameters<TelegramPromptStream>[2]>
>[0];

interface TelegramIncomingTextContext {
	chat: TelegramTextHandlerContext["chat"];
	from?: { id: number };
	message: TelegramTextHandlerContext["message"];
	reply: TelegramTextHandlerContext["reply"];
	replyWithChatAction: TelegramTextHandlerContext["replyWithChatAction"];
	replyWithPhoto: TelegramTextHandlerContext["replyWithPhoto"];
	sendMessage: TelegramTextHandlerContext["sendMessage"];
	editMessageText: TelegramTextHandlerContext["editMessageText"];
}

interface TelegramIncomingPhotoContext {
	api: {
		getFile(fileId: string): Promise<{ file_path?: string }>;
		editMessageText(
			chatId: number,
			messageId: number,
			text: string,
			options?: object,
		): Promise<unknown>;
	};
	chat: TelegramPhotoHandlerContext["chat"];
	from?: { id: number };
	message: TelegramPhotoHandlerContext["message"];
	reply: TelegramPhotoHandlerContext["reply"];
	replyWithChatAction: TelegramPhotoHandlerContext["replyWithChatAction"];
	replyWithPhoto: TelegramPhotoHandlerContext["replyWithPhoto"];
	sendMessage: TelegramPhotoHandlerContext["sendMessage"];
	editMessageText: TelegramPhotoHandlerContext["editMessageText"];
}

interface TelegramIncomingDocumentContext {
	api: {
		getFile(fileId: string): Promise<{ file_path?: string }>;
	};
	chat: TelegramDocumentHandlerContext["chat"];
	from?: { id: number };
	message: TelegramDocumentHandlerContext["message"];
	reply: TelegramDocumentHandlerContext["reply"];
	replyWithChatAction: TelegramDocumentHandlerContext["replyWithChatAction"];
	replyWithPhoto: TelegramDocumentHandlerContext["replyWithPhoto"];
	sendMessage: TelegramDocumentHandlerContext["sendMessage"];
	editMessageText: TelegramDocumentHandlerContext["editMessageText"];
}

interface TelegramBridgeLike {
	close(): void;
	stream(
		prompt: string,
		images?: ImageRef[],
		onImage?: (event: TelegramImageEvent) => void | Promise<void>,
		telegramChatId?: number,
		replyContext?: ReplyContext,
	): AsyncIterable<StreamChunk>;
}

interface TelegramBotLike {
	readonly api: {
		readonly config: {
			use(middleware: unknown): unknown;
		};
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
		sendPhoto(
			chatId: number,
			photo: unknown,
			options?: object,
		): Promise<{ message_id: number }>;
		setMyCommands(commands: typeof TELEGRAM_COMMANDS): Promise<unknown>;
	};
	use(middleware: unknown): unknown;
	command(
		command: string,
		handler: (ctx: Record<string, unknown>) => Promise<void>,
	): unknown;
	callbackQuery(
		pattern: RegExp,
		handler: (ctx: Record<string, unknown>) => Promise<void>,
	): unknown;
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
	start(): unknown;
	stop(): unknown;
}

interface TelegramBotDependencies {
	createAutoRetryMiddleware(): unknown;
	createBot(token: string): TelegramBotLike;
	createBridge(runtimeUrl: string): TelegramBridgeLike;
	createInputFile(path: string): unknown;
	handleDocumentMessage: typeof handleTelegramDocumentMessage;
	handlePhotoMessage: typeof handleTelegramPhotoMessage;
	handleTextMessage: typeof handleTelegramTextMessage;
	logError(message: string): void;
	logInfo(message: string): void;
	registerModelShortcuts(
		registrar: TelegramBotLike,
		bridge: TelegramBridgeLike,
	): void;
	registerPromptCommands(
		registrar: TelegramBotLike,
		bridge: TelegramBridgeLike,
	): void;
	registerRuntimeCommands(
		registrar: TelegramBotLike,
		bridge: TelegramBridgeLike,
	): void;
	registerSessionHandlers(
		registrar: TelegramBotLike,
		bridge: TelegramBridgeLike,
	): void;
	sendHeartbeatResult: typeof sendTelegramHeartbeatResult;
}

const DEFAULT_TELEGRAM_BOT_DEPENDENCIES: TelegramBotDependencies = {
	createAutoRetryMiddleware: () => autoRetry(),
	createBot: (token) => new Bot<MyContext>(token) as unknown as TelegramBotLike,
	createBridge: (runtimeUrl) => createTelegramBridge(runtimeUrl),
	createInputFile: (path) => new InputFile(path),
	handleDocumentMessage: (ctx, options) =>
		handleTelegramDocumentMessage(ctx, options),
	handlePhotoMessage: (ctx, options) =>
		handleTelegramPhotoMessage(ctx, options),
	handleTextMessage: (ctx, options) => handleTelegramTextMessage(ctx, options),
	logError: (message) => console.error(message),
	logInfo: (message) => console.log(message),
	registerModelShortcuts: (registrar, bridge) =>
		registerTelegramModelShortcuts(
			registrar as unknown as Parameters<
				typeof registerTelegramModelShortcuts
			>[0],
			bridge as unknown as Parameters<typeof registerTelegramModelShortcuts>[1],
		),
	registerPromptCommands: (registrar, bridge) =>
		registerTelegramPromptCommands(
			registrar as unknown as Parameters<
				typeof registerTelegramPromptCommands
			>[0],
			bridge as unknown as Parameters<typeof registerTelegramPromptCommands>[1],
		),
	registerRuntimeCommands: (registrar, bridge) =>
		registerTelegramRuntimeCommands(
			registrar as unknown as Parameters<
				typeof registerTelegramRuntimeCommands
			>[0],
			bridge as unknown as Parameters<
				typeof registerTelegramRuntimeCommands
			>[1],
		),
	registerSessionHandlers: (registrar, bridge) =>
		registerTelegramSessionHandlers(
			registrar as unknown as Parameters<
				typeof registerTelegramSessionHandlers
			>[0],
			bridge as unknown as Parameters<
				typeof registerTelegramSessionHandlers
			>[1],
		),
	sendHeartbeatResult: (ctx, params) =>
		sendTelegramHeartbeatResult(ctx, params),
};

export interface TelegramBotOptions {
	token: string;
	runtimeUrl: string;
	allowedUsers: number[];
	filesRoot: string;
	resolveMessageFile?: (
		chatId: number,
		messageId: number,
	) => Promise<TelegramMessageFile | undefined>;
	rememberMessageFile?: (params: TelegramMessageFileRecord) => Promise<void>;
}

export function startTelegramBot(
	{
		token,
		runtimeUrl,
		allowedUsers,
		filesRoot,
		resolveMessageFile,
		rememberMessageFile,
	}: TelegramBotOptions,
	overrides: Partial<TelegramBotDependencies> = {},
) {
	const dependencies = {
		...DEFAULT_TELEGRAM_BOT_DEPENDENCIES,
		...overrides,
	};
	const bot = dependencies.createBot(token);
	bot.api.config.use(dependencies.createAutoRetryMiddleware());

	const allowed = new Set(allowedUsers);
	bot.use(
		async (ctx: { from?: { id: number } }, next: () => Promise<unknown>) => {
			if (ctx.from && allowed.has(ctx.from.id)) {
				return next();
			}
		},
	);

	const bridge = dependencies.createBridge(runtimeUrl);

	void bot.api.setMyCommands(TELEGRAM_COMMANDS).catch((err) => {
		dependencies.logError(
			`Failed to register Telegram commands: ${extractError(err)}`,
		);
	});

	dependencies.registerSessionHandlers(bot, bridge);
	dependencies.registerRuntimeCommands(bot, bridge);
	dependencies.registerPromptCommands(bot, bridge);
	dependencies.registerModelShortcuts(bot, bridge);

	bot.on("message:text", async (ctx) => {
		await dependencies.handleTextMessage(
			{
				chat: ctx.chat,
				message: ctx.message,
				reply: (text) => ctx.reply(text),
				replyWithChatAction: (action) => ctx.replyWithChatAction(action),
				replyWithPhoto: (photo, options) => ctx.replyWithPhoto(photo, options),
				sendMessage: (text, options) =>
					bot.api.sendMessage(ctx.chat.id, text, options),
				editMessageText: (messageId, text, options) =>
					bot.api.editMessageText(ctx.chat.id, messageId, text, options),
			},
			{
				resolveMessageFile,
				rememberMessageFile,
				streamPrompt: (prompt, images, onImage, replyContext) =>
					bridge.stream(prompt, images, onImage, ctx.chat.id, replyContext),
			},
		);
	});

	bot.on("message:photo", async (ctx) => {
		const largestPhoto = ctx.message.photo.at(-1);
		if (!largestPhoto) {
			await ctx.reply("[error] Telegram photo message is missing photo sizes");
			return;
		}

		await dependencies.handlePhotoMessage(
			{
				chat: ctx.chat,
				getFile: () => ctx.api.getFile(largestPhoto.file_id),
				message: ctx.message,
				reply: (text) => ctx.reply(text),
				replyWithChatAction: (action) => ctx.replyWithChatAction(action),
				replyWithPhoto: (photo, options) => ctx.replyWithPhoto(photo, options),
				sendMessage: (text, options) =>
					bot.api.sendMessage(ctx.chat.id, text, options),
				editMessageText: (messageId, text, options) =>
					bot.api.editMessageText(ctx.chat.id, messageId, text, options),
			},
			{
				resolveMessageFile,
				rememberMessageFile,
				token,
				filesRoot,
				streamPrompt: (prompt, images, onImage, replyContext) =>
					bridge.stream(prompt, images, onImage, ctx.chat.id, replyContext),
			},
		);
	});

	bot.on("message:document", async (ctx) => {
		await dependencies.handleDocumentMessage(
			{
				chat: ctx.chat,
				getFile: () => ctx.api.getFile(ctx.message.document.file_id),
				message: ctx.message,
				reply: (text) => ctx.reply(text),
				replyWithChatAction: (action) => ctx.replyWithChatAction(action),
				replyWithPhoto: (photo, options) => ctx.replyWithPhoto(photo, options),
				sendMessage: (text, options) =>
					bot.api.sendMessage(ctx.chat.id, text, options),
				editMessageText: (messageId, text, options) =>
					bot.api.editMessageText(ctx.chat.id, messageId, text, options),
			},
			{
				resolveMessageFile,
				rememberMessageFile,
				token,
				filesRoot,
				streamPrompt: (prompt, images, onImage, replyContext) =>
					bridge.stream(prompt, images, onImage, ctx.chat.id, replyContext),
			},
		);
	});

	bot.start();

	dependencies.logInfo("Telegram bot started");

	return {
		async sendCronResult(params: {
			jobName: string;
			telegramChatId: number;
			text: string;
		}) {
			const raw = params.text.trim()
				? `[cron] ${params.jobName}\n${params.text}`
				: `[cron] ${params.jobName}`;
			const html = markdownToTelegramHtml(raw);
			const chunks = splitTelegramHtml(html || raw, TELEGRAM_MESSAGE_LIMIT);
			for (const chunk of chunks) {
				await bot.api.sendMessage(params.telegramChatId, chunk, {
					parse_mode: "HTML",
					disable_notification: true,
				});
			}
		},
		async sendHeartbeatResult(params: {
			telegramChatId: number;
			text: string;
			images: Array<{ path: string; caption?: string }>;
		}) {
			await dependencies.sendHeartbeatResult(
				{
					sendMessage: (chatId, text, options) =>
						bot.api.sendMessage(chatId, text, options),
					sendPhoto: (chatId, path, options) =>
						bot.api.sendPhoto(
							chatId,
							dependencies.createInputFile(path),
							options,
						),
				},
				{
					...params,
					rememberMessageFile,
				},
			);
		},
		stop() {
			bot.stop();
			bridge.close();
		},
	};
}
