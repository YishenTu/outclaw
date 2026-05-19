import { autoRetry } from "@grammyjs/auto-retry";
import { Bot, type Context, InputFile } from "grammy";
import { extractError } from "../../common/protocol.ts";
import {
	createAllowedUsersMiddleware,
	createPrivateChatMiddleware,
} from "./authorization.ts";
import { createTelegramBridge } from "./bridge/client.ts";
import { TELEGRAM_COMMANDS } from "./commands/catalog.ts";
import { registerTelegramPromptCommands } from "./commands/prompt.ts";
import {
	handleTelegramRuntimeTextCommand,
	registerTelegramRuntimeCommands,
} from "./commands/runtime.ts";
import type {
	TelegramMessageFile,
	TelegramMessageFileRecord,
} from "./files/message-file-ref.ts";
import {
	handleTelegramMemoryTextCommand,
	registerTelegramMemoryHandlers,
} from "./memory/register.ts";
import {
	registerTelegramMessageHandlers,
	type TelegramIncomingDocumentContext,
	type TelegramIncomingPhotoContext,
	type TelegramIncomingTextContext,
	type TelegramIncomingVoiceContext,
	type TelegramMessageHandlerDependencies,
} from "./message-handlers.ts";
import { handleTelegramDocumentMessage } from "./messages/document.ts";
import { sendTelegramHeartbeatResult } from "./messages/heartbeat-result.ts";
import { handleTelegramPhotoMessage } from "./messages/photo.ts";
import { handleTelegramTextMessage } from "./messages/text.ts";
import { handleTelegramVoiceMessage } from "./messages/voice.ts";
import { createTelegramOutboundSender } from "./outbound-notifications.ts";
import {
	createTelegramContextBridge,
	type TelegramBridgeFactory,
	type TelegramBridgeLike,
} from "./routing.ts";
import { registerTelegramSessionHandlers } from "./sessions/register.ts";

type MyContext = Context;

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
		leaveChat(chatId: number): Promise<unknown>;
		setMyCommands(commands: typeof TELEGRAM_COMMANDS): Promise<unknown>;
	};
	use(middleware: unknown): unknown;
	command(
		command: string,
		handler: (
			ctx: Record<string, unknown> & {
				from?: { id: number };
				reply(text: string, options?: object): Promise<unknown>;
			},
		) => Promise<void>,
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
	on(
		event: "message:voice",
		handler: (ctx: TelegramIncomingVoiceContext) => Promise<void>,
	): unknown;
	on(
		event: "message:audio",
		handler: (ctx: TelegramIncomingVoiceContext) => Promise<void>,
	): unknown;
	start(): unknown;
	stop(): unknown;
}

interface TelegramBotDependencies extends TelegramMessageHandlerDependencies {
	createAutoRetryMiddleware(): unknown;
	createBot(token: string): TelegramBotLike;
	createBridge(runtimeUrl: string): TelegramBridgeLike;
	createInputFile(path: string): unknown;
	logError(message: string): void;
	logInfo(message: string): void;
	registerMemoryHandlers(
		registrar: TelegramBotLike,
		createBridge: TelegramBridgeFactory,
	): void;
	registerPromptCommands(
		registrar: TelegramBotLike,
		createBridge: TelegramBridgeFactory,
	): void;
	registerRuntimeCommands(
		registrar: TelegramBotLike,
		createBridge: TelegramBridgeFactory,
	): void;
	registerSessionHandlers(
		registrar: TelegramBotLike,
		createBridge: TelegramBridgeFactory,
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
	handleVoiceMessage: (ctx, options) =>
		handleTelegramVoiceMessage(ctx, options),
	handleMemoryTextCommand: (ctx, bridge) =>
		handleTelegramMemoryTextCommand(
			ctx as unknown as Parameters<typeof handleTelegramMemoryTextCommand>[0],
			bridge as unknown as Parameters<
				typeof handleTelegramMemoryTextCommand
			>[1],
		),
	handleRuntimeTextCommand: (ctx, bridge) =>
		handleTelegramRuntimeTextCommand(
			ctx as unknown as Parameters<typeof handleTelegramRuntimeTextCommand>[0],
			bridge as unknown as Parameters<
				typeof handleTelegramRuntimeTextCommand
			>[1],
		),
	logError: (message) => console.error(message),
	logInfo: (message) => console.log(message),
	registerMemoryHandlers: (registrar, bridge) =>
		registerTelegramMemoryHandlers(
			registrar as unknown as Parameters<
				typeof registerTelegramMemoryHandlers
			>[0],
			bridge as unknown as Parameters<typeof registerTelegramMemoryHandlers>[1],
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
	botId: string;
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
		botId,
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

	bot.use(
		createPrivateChatMiddleware({
			leaveChat: (chatId) => bot.api.leaveChat(chatId),
			logError: dependencies.logError,
		}),
	);
	bot.use(createAllowedUsersMiddleware(allowedUsers));

	const bridge = dependencies.createBridge(runtimeUrl);
	const createContextBridge = (ctx: { from?: { id: number } }) =>
		createTelegramContextBridge({
			botId,
			bridge,
			from: ctx.from,
		});

	void bot.api.setMyCommands(TELEGRAM_COMMANDS).catch((err) => {
		dependencies.logError(
			`Failed to register Telegram commands: ${extractError(err)}`,
		);
	});

	bot.command(
		"start",
		async (ctx: {
			from?: { id: number };
			reply(text: string): Promise<unknown>;
		}) => {
			await ctx.reply(`Your Telegram user ID is ${ctx.from?.id ?? "unknown"}`);
		},
	);

	dependencies.registerSessionHandlers(bot, (ctx) => createContextBridge(ctx));
	dependencies.registerRuntimeCommands(bot, (ctx) => createContextBridge(ctx));
	dependencies.registerMemoryHandlers(bot, (ctx) => createContextBridge(ctx));
	dependencies.registerPromptCommands(bot, (ctx) => createContextBridge(ctx));

	registerTelegramMessageHandlers({
		bot,
		createBridge: createContextBridge,
		dependencies,
		filesRoot,
		rememberMessageFile,
		resolveMessageFile,
		token,
	});

	bot.start();

	dependencies.logInfo("Telegram bot started");
	const outbound = createTelegramOutboundSender({
		api: bot.api,
		createInputFile: dependencies.createInputFile,
		rememberMessageFile,
		sendHeartbeatResult: dependencies.sendHeartbeatResult,
	});

	return {
		sendCronResult: outbound.sendCronResult,
		sendHeartbeatResult: outbound.sendHeartbeatResult,
		sendRolloverNotice: outbound.sendRolloverNotice,
		stop() {
			bot.stop();
			bridge.close();
		},
	};
}
