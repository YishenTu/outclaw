import { afterEach, describe, expect, mock, test } from "bun:test";
import { startTelegramBot } from "../../../src/frontend/telegram/bot.ts";
import { TELEGRAM_COMMANDS } from "../../../src/frontend/telegram/commands/catalog.ts";

const autoRetryMiddleware = Symbol("autoRetry");

function createEmptyTextStream() {
	return (async function* () {})();
}

let bridge = {
	close: mock(() => {}),
	sendCommandAndWait: mock(async () => ({ type: "done" })),
	stream: mock(
		(
			_prompt: string,
			_images?: unknown[],
			_onImage?: unknown,
			_chatId?: number,
		) => createEmptyTextStream(),
	),
};
let createTelegramBridge = mock((_runtimeUrl: string) => bridge);
let registerTelegramSessionHandlers = mock(() => {});
let registerTelegramRuntimeCommands = mock(() => {});
let registerTelegramPromptCommands = mock(() => {});
let registerTelegramModelShortcuts = mock(() => {});
let lastHeartbeatArgs: unknown[] = [];
let lastTextMessageArgs: unknown[] = [];
let lastPhotoMessageArgs: unknown[] = [];
let lastDocumentMessageArgs: unknown[] = [];
let lastVoiceMessageArgs: unknown[] = [];
let sendTelegramHeartbeatResult = mock(async (...args: unknown[]) => {
	lastHeartbeatArgs = args;
	return undefined;
});
let handleTelegramTextMessage = mock(async (...args: unknown[]) => {
	lastTextMessageArgs = args;
	return undefined;
});
let handleTelegramPhotoMessage = mock(async (...args: unknown[]) => {
	lastPhotoMessageArgs = args;
	return undefined;
});
let handleTelegramDocumentMessage = mock(async (...args: unknown[]) => {
	lastDocumentMessageArgs = args;
	return undefined;
});
let handleTelegramVoiceMessage = mock(async (...args: unknown[]) => {
	lastVoiceMessageArgs = args;
	return undefined;
});
let setMyCommandsImpl: (commands: unknown) => Promise<unknown> = async (
	_commands: unknown,
) => undefined;

class FakeInputFile {
	constructor(readonly path: string) {}
}

class FakeBot {
	static lastInstance: FakeBot | undefined;

	readonly commandHandlers = new Map<
		string,
		(ctx: Record<string, unknown>) => Promise<void>
	>();
	readonly handlers = new Map<
		string,
		(ctx: Record<string, unknown>) => Promise<void>
	>();
	readonly middleware: unknown[] = [];
	readonly api = {
		config: {
			use: mock((_middleware: unknown) => undefined),
		},
		sendMessage: mock(
			async (_chatId: number, _message: string, _options?: object) => ({
				message_id: 1,
			}),
		),
		editMessageText: mock(
			async (
				_chatId: number,
				_messageId: number,
				_text: string,
				_options?: object,
			) => ({}),
		),
		sendPhoto: mock(
			async (_chatId: number, _photo: unknown, _options?: object) => ({
				message_id: 2,
			}),
		),
		leaveChat: mock(async (_chatId: number) => undefined),
		setMyCommands: mock(async (commands: unknown) =>
			setMyCommandsImpl(commands),
		),
	};
	readonly start = mock(() => undefined);
	readonly stop = mock(() => undefined);

	constructor(readonly token: string) {
		FakeBot.lastInstance = this;
	}

	use(handler: unknown) {
		this.middleware.push(handler);
		return this;
	}

	command(
		command: string,
		_handler: (ctx: Record<string, unknown>) => Promise<void>,
	) {
		this.commandHandlers.set(command, _handler);
		return this;
	}

	callbackQuery(
		_pattern: RegExp,
		_handler: (ctx: Record<string, unknown>) => Promise<void>,
	) {
		return this;
	}

	on(event: string, handler: (ctx: Record<string, unknown>) => Promise<void>) {
		this.handlers.set(event, handler);
		return this;
	}
}

function resetFakes() {
	bridge = {
		close: mock(() => {}),
		sendCommandAndWait: mock(async () => ({ type: "done" })),
		stream: mock(
			(
				_prompt: string,
				_images?: unknown[],
				_onImage?: unknown,
				_chatId?: number,
			) => createEmptyTextStream(),
		),
	};
	createTelegramBridge = mock((_runtimeUrl: string) => bridge);
	registerTelegramSessionHandlers = mock(() => {});
	registerTelegramRuntimeCommands = mock(() => {});
	registerTelegramPromptCommands = mock(() => {});
	registerTelegramModelShortcuts = mock(() => {});
	lastHeartbeatArgs = [];
	lastTextMessageArgs = [];
	lastPhotoMessageArgs = [];
	lastDocumentMessageArgs = [];
	lastVoiceMessageArgs = [];
	sendTelegramHeartbeatResult = mock(async (...args: unknown[]) => {
		lastHeartbeatArgs = args;
		return undefined;
	});
	handleTelegramTextMessage = mock(async (...args: unknown[]) => {
		lastTextMessageArgs = args;
		return undefined;
	});
	handleTelegramPhotoMessage = mock(async (...args: unknown[]) => {
		lastPhotoMessageArgs = args;
		return undefined;
	});
	handleTelegramDocumentMessage = mock(async (...args: unknown[]) => {
		lastDocumentMessageArgs = args;
		return undefined;
	});
	handleTelegramVoiceMessage = mock(async (...args: unknown[]) => {
		lastVoiceMessageArgs = args;
		return undefined;
	});
	setMyCommandsImpl = async (_commands: unknown) => undefined;
	FakeBot.lastInstance = undefined;
}

function createTestDependencies(params: {
	logError?: (message: string) => void;
	logInfo?: (message: string) => void;
}) {
	return {
		createAutoRetryMiddleware: () => autoRetryMiddleware,
		createBot: (token: string) => new FakeBot(token) as never,
		createBridge: (...args: Parameters<typeof createTelegramBridge>) =>
			createTelegramBridge(...args) as never,
		createInputFile: (path: string) => new FakeInputFile(path),
		handleDocumentMessage: (
			...args: Parameters<typeof handleTelegramDocumentMessage>
		) => handleTelegramDocumentMessage(...args),
		handleVoiceMessage: (
			...args: Parameters<typeof handleTelegramVoiceMessage>
		) => handleTelegramVoiceMessage(...args),
		handlePhotoMessage: (
			...args: Parameters<typeof handleTelegramPhotoMessage>
		) => handleTelegramPhotoMessage(...args),
		handleTextMessage: (
			...args: Parameters<typeof handleTelegramTextMessage>
		) => handleTelegramTextMessage(...args),
		logError: params.logError ?? (() => undefined),
		logInfo: params.logInfo ?? (() => undefined),
		registerModelShortcuts: (
			...args: Parameters<typeof registerTelegramModelShortcuts>
		) => registerTelegramModelShortcuts(...args),
		registerRuntimeCommands: (
			...args: Parameters<typeof registerTelegramRuntimeCommands>
		) => registerTelegramRuntimeCommands(...args),
		registerPromptCommands: (
			...args: Parameters<typeof registerTelegramPromptCommands>
		) => registerTelegramPromptCommands(...args),
		registerSessionHandlers: (
			...args: Parameters<typeof registerTelegramSessionHandlers>
		) => registerTelegramSessionHandlers(...args),
		sendHeartbeatResult: (
			...args: Parameters<typeof sendTelegramHeartbeatResult>
		) => sendTelegramHeartbeatResult(...args),
	};
}

describe("startTelegramBot", () => {
	afterEach(() => {
		resetFakes();
	});

	test("wires startup, middleware, handlers, and service methods", async () => {
		const log = mock(() => undefined);
		const rememberMessageFile = mock(async () => undefined);
		const service = startTelegramBot(
			{
				botId: "bot-a",
				token: "telegram-token",
				runtimeUrl: "ws://runtime",
				allowedUsers: [1],
				filesRoot: "/tmp/files",
				rememberMessageFile,
			},
			createTestDependencies({ logInfo: log }),
		);

		const bot = FakeBot.lastInstance as FakeBot;
		expect(bot.token).toBe("telegram-token");
		expect(bot.api.config.use).toHaveBeenCalledWith(autoRetryMiddleware);
		expect(createTelegramBridge).toHaveBeenCalledWith("ws://runtime");
		expect(bot.api.setMyCommands).toHaveBeenCalledWith(TELEGRAM_COMMANDS);
		expect(registerTelegramSessionHandlers).toHaveBeenCalledWith(
			bot,
			expect.any(Function),
		);
		expect(registerTelegramRuntimeCommands).toHaveBeenCalledWith(
			bot,
			expect.any(Function),
		);
		expect(registerTelegramPromptCommands).toHaveBeenCalledWith(
			bot,
			expect.any(Function),
		);
		expect(registerTelegramModelShortcuts).toHaveBeenCalledWith(
			bot,
			expect.any(Function),
		);
		expect(bot.start).toHaveBeenCalledTimes(1);
		expect(log).toHaveBeenCalledWith("Telegram bot started");

		const groupBlockerMiddleware = bot.middleware[0] as (
			ctx: { chat?: { id: number; type: string } },
			next: () => Promise<unknown>,
		) => Promise<unknown>;
		const privateNext = mock(async () => "private");
		await expect(
			groupBlockerMiddleware(
				{ chat: { id: 100, type: "private" } },
				privateNext,
			),
		).resolves.toBe("private");
		expect(privateNext).toHaveBeenCalledTimes(1);
		expect(bot.api.leaveChat).not.toHaveBeenCalled();

		const groupNext = mock(async () => "group");
		await expect(
			groupBlockerMiddleware({ chat: { id: -200, type: "group" } }, groupNext),
		).resolves.toBeUndefined();
		expect(groupNext).not.toHaveBeenCalled();
		expect(bot.api.leaveChat).toHaveBeenCalledWith(-200);

		const supergroupNext = mock(async () => "supergroup");
		await expect(
			groupBlockerMiddleware(
				{ chat: { id: -300, type: "supergroup" } },
				supergroupNext,
			),
		).resolves.toBeUndefined();
		expect(supergroupNext).not.toHaveBeenCalled();
		expect(bot.api.leaveChat).toHaveBeenCalledWith(-300);

		const channelNext = mock(async () => "channel");
		await expect(
			groupBlockerMiddleware(
				{ chat: { id: -400, type: "channel" } },
				channelNext,
			),
		).resolves.toBeUndefined();
		expect(channelNext).not.toHaveBeenCalled();
		expect(bot.api.leaveChat).toHaveBeenCalledWith(-400);

		const noChatNext = mock(async () => "no-chat");
		await expect(groupBlockerMiddleware({}, noChatNext)).resolves.toBe(
			"no-chat",
		);
		expect(noChatNext).toHaveBeenCalledTimes(1);

		const authMiddleware = bot.middleware[1] as (
			ctx: { from?: { id: number }; message?: { text?: string } },
			next: () => Promise<unknown>,
		) => Promise<unknown>;
		const allowedNext = mock(async () => "allowed");
		await expect(
			authMiddleware({ from: { id: 1 } }, allowedNext),
		).resolves.toBe("allowed");
		expect(allowedNext).toHaveBeenCalledTimes(1);

		const blockedNext = mock(async () => "blocked");
		await expect(
			authMiddleware({ from: { id: 999 } }, blockedNext),
		).resolves.toBeUndefined();
		expect(blockedNext).not.toHaveBeenCalled();

		const startNext = mock(async () => "start");
		await expect(
			authMiddleware(
				{ from: { id: 999 }, message: { text: "/start" } },
				startNext,
			),
		).resolves.toBe("start");
		expect(startNext).toHaveBeenCalledTimes(1);

		const startReply = mock(async (_text: string) => undefined);
		await bot.commandHandlers.get("start")?.({
			from: { id: 999 },
			reply: startReply,
		});
		expect(startReply).toHaveBeenCalledWith("Your Telegram user ID is 999");

		const textCtx = {
			chat: { id: 42 },
			message: { text: "hello" },
			reply: mock(async () => undefined),
			replyWithChatAction: mock(async () => undefined),
			replyWithPhoto: mock(async () => undefined),
		};
		await bot.handlers.get("message:text")?.(textCtx);
		expect(handleTelegramTextMessage).toHaveBeenCalledTimes(1);
		const textDeps = lastTextMessageArgs[1] as {
			streamPrompt: (
				prompt: string,
				images: unknown[],
				onImage: () => void,
				replyContext?: { text: string },
			) => Promise<unknown>;
		};
		const onTextImage = () => undefined;
		await textDeps.streamPrompt("hello", [], onTextImage, {
			text: "previous message",
		});
		expect(bridge.stream).toHaveBeenCalledWith(
			"hello",
			[],
			onTextImage,
			42,
			{
				text: "previous message",
			},
			{
				telegramBotId: "bot-a",
				telegramUserId: undefined,
			},
		);
		const textHandlerCtx = lastTextMessageArgs[0] as {
			replyWithChatAction: (action: string) => Promise<unknown>;
			replyWithPhoto: (photo: string, options?: object) => Promise<unknown>;
			sendMessage: (text: string, options?: object) => Promise<unknown>;
			editMessageText: (
				messageId: number,
				text: string,
				options?: object,
			) => Promise<unknown>;
		};
		await textHandlerCtx.replyWithChatAction("typing");
		await textHandlerCtx.replyWithPhoto("/tmp/text-image.png", {
			caption: "Text",
		});
		await textHandlerCtx.sendMessage("text update", { parse_mode: "HTML" });
		await textHandlerCtx.editMessageText(12, "edited text", {
			parse_mode: "HTML",
		});
		expect(textCtx.replyWithChatAction).toHaveBeenCalledWith("typing");
		expect(textCtx.replyWithPhoto).toHaveBeenCalledWith("/tmp/text-image.png", {
			caption: "Text",
		});
		expect(bot.api.sendMessage).toHaveBeenCalledWith(42, "text update", {
			parse_mode: "HTML",
		});
		expect(bot.api.editMessageText).toHaveBeenCalledWith(
			42,
			12,
			"edited text",
			{
				parse_mode: "HTML",
			},
		);

		const missingPhotoCtx = {
			chat: { id: 7 },
			message: { photo: [] },
			reply: mock(async () => undefined),
		};
		await bot.handlers.get("message:photo")?.(missingPhotoCtx);
		expect(missingPhotoCtx.reply).toHaveBeenCalledWith(
			"[error] Telegram photo message is missing photo sizes",
		);

		const photoCtx = {
			api: {
				getFile: mock(async (_fileId: string) => ({ file_path: "photo.jpg" })),
			},
			chat: { id: 7 },
			message: {
				photo: [{ file_id: "small" }, { file_id: "large" }],
			},
			reply: mock(async () => undefined),
			replyWithChatAction: mock(async () => undefined),
			replyWithPhoto: mock(async () => undefined),
		};
		await bot.handlers.get("message:photo")?.(photoCtx);
		expect(handleTelegramPhotoMessage).toHaveBeenCalledTimes(1);
		const photoHandlerCtx = lastPhotoMessageArgs[0] as {
			getFile: () => Promise<unknown>;
		};
		await photoHandlerCtx.getFile();
		expect(photoCtx.api.getFile).toHaveBeenCalledWith("large");
		const photoDeps = lastPhotoMessageArgs[1] as {
			streamPrompt: (
				prompt: string,
				images: unknown[],
				onImage: () => void,
				replyContext?: { text: string },
			) => Promise<unknown>;
		};
		const onPhotoImage = () => undefined;
		await photoDeps.streamPrompt("plot", [], onPhotoImage, {
			text: "previous photo",
		});
		expect(bridge.stream).toHaveBeenCalledWith(
			"plot",
			[],
			onPhotoImage,
			7,
			{
				text: "previous photo",
			},
			{
				telegramBotId: "bot-a",
				telegramUserId: undefined,
			},
		);
		await (
			lastPhotoMessageArgs[0] as {
				replyWithChatAction: (action: string) => Promise<unknown>;
				replyWithPhoto: (photo: string, options?: object) => Promise<unknown>;
				sendMessage: (text: string, options?: object) => Promise<unknown>;
				editMessageText: (
					messageId: number,
					text: string,
					options?: object,
				) => Promise<unknown>;
			}
		).replyWithChatAction("upload_photo");
		await (
			lastPhotoMessageArgs[0] as {
				replyWithPhoto: (photo: string, options?: object) => Promise<unknown>;
			}
		).replyWithPhoto("/tmp/photo-preview.png", { caption: "Preview" });
		await (
			lastPhotoMessageArgs[0] as {
				sendMessage: (text: string, options?: object) => Promise<unknown>;
			}
		).sendMessage("photo update", { parse_mode: "HTML" });
		await (
			lastPhotoMessageArgs[0] as {
				editMessageText: (
					messageId: number,
					text: string,
					options?: object,
				) => Promise<unknown>;
			}
		).editMessageText(24, "photo edited", { parse_mode: "HTML" });
		expect(photoCtx.replyWithChatAction).toHaveBeenCalledWith("upload_photo");
		expect(photoCtx.replyWithPhoto).toHaveBeenCalledWith(
			"/tmp/photo-preview.png",
			{
				caption: "Preview",
			},
		);
		expect(bot.api.sendMessage).toHaveBeenCalledWith(7, "photo update", {
			parse_mode: "HTML",
		});
		expect(bot.api.editMessageText).toHaveBeenCalledWith(
			7,
			24,
			"photo edited",
			{
				parse_mode: "HTML",
			},
		);

		const docCtx = {
			api: {
				getFile: mock(async (_fileId: string) => ({
					file_path: "documents/report.pdf",
				})),
			},
			chat: { id: 8 },
			message: {
				caption: "analyse this",
				document: { file_id: "doc-1", file_name: "report.pdf" },
			},
			reply: mock(async () => undefined),
			replyWithChatAction: mock(async () => undefined),
			replyWithPhoto: mock(async () => undefined),
		};
		await bot.handlers.get("message:document")?.(docCtx);
		expect(handleTelegramDocumentMessage).toHaveBeenCalledTimes(1);
		const docHandlerCtx = lastDocumentMessageArgs[0] as {
			getFile: () => Promise<unknown>;
		};
		await docHandlerCtx.getFile();
		expect(docCtx.api.getFile).toHaveBeenCalledWith("doc-1");
		const docDeps = lastDocumentMessageArgs[1] as {
			streamPrompt: (
				prompt: string,
				images: unknown[],
				onImage: () => void,
				replyContext?: { text: string },
			) => Promise<unknown>;
		};
		const onDocImage = () => undefined;
		await docDeps.streamPrompt("analyse this", [], onDocImage, {
			text: "previous doc",
		});
		expect(bridge.stream).toHaveBeenCalledWith(
			"analyse this",
			[],
			onDocImage,
			8,
			{ text: "previous doc" },
			{
				telegramBotId: "bot-a",
				telegramUserId: undefined,
			},
		);
		await (
			lastDocumentMessageArgs[0] as {
				replyWithChatAction: (action: string) => Promise<unknown>;
				replyWithPhoto: (photo: string, options?: object) => Promise<unknown>;
				sendMessage: (text: string, options?: object) => Promise<unknown>;
				editMessageText: (
					messageId: number,
					text: string,
					options?: object,
				) => Promise<unknown>;
			}
		).replyWithChatAction("upload_document");
		await (
			lastDocumentMessageArgs[0] as {
				replyWithPhoto: (photo: string, options?: object) => Promise<unknown>;
			}
		).replyWithPhoto("/tmp/doc-preview.png", { caption: "Doc preview" });
		await (
			lastDocumentMessageArgs[0] as {
				sendMessage: (text: string, options?: object) => Promise<unknown>;
			}
		).sendMessage("document update", { parse_mode: "HTML" });
		await (
			lastDocumentMessageArgs[0] as {
				editMessageText: (
					messageId: number,
					text: string,
					options?: object,
				) => Promise<unknown>;
			}
		).editMessageText(36, "document edited", { parse_mode: "HTML" });
		expect(docCtx.replyWithChatAction).toHaveBeenCalledWith("upload_document");
		expect(docCtx.replyWithPhoto).toHaveBeenCalledWith("/tmp/doc-preview.png", {
			caption: "Doc preview",
		});
		expect(bot.api.sendMessage).toHaveBeenCalledWith(8, "document update", {
			parse_mode: "HTML",
		});
		expect(bot.api.editMessageText).toHaveBeenCalledWith(
			8,
			36,
			"document edited",
			{
				parse_mode: "HTML",
			},
		);

		const voiceCtx = {
			api: {
				getFile: mock(async (_fileId: string) => ({
					file_path: "voice/file_1.oga",
				})),
			},
			chat: { id: 9 },
			message: {
				voice: {
					file_id: "voice-1",
					file_size: 1024,
					mime_type: "audio/ogg",
					duration: 12,
				},
			},
			reply: mock(async () => undefined),
			replyWithChatAction: mock(async () => undefined),
			replyWithPhoto: mock(async () => undefined),
		};
		await bot.handlers.get("message:voice")?.(voiceCtx);
		expect(handleTelegramVoiceMessage).toHaveBeenCalledTimes(1);
		const voiceHandlerCtx = lastVoiceMessageArgs[0] as {
			getFile: () => Promise<unknown>;
		};
		await voiceHandlerCtx.getFile();
		expect(voiceCtx.api.getFile).toHaveBeenCalledWith("voice-1");
		const voiceDeps = lastVoiceMessageArgs[1] as {
			streamPrompt: (
				prompt: string,
				images: unknown[],
				onImage: () => void,
				replyContext?: { text: string },
			) => Promise<unknown>;
		};
		const onVoiceImage = () => undefined;
		await voiceDeps.streamPrompt("transcribe", [], onVoiceImage, {
			text: "previous voice",
		});
		expect(bridge.stream).toHaveBeenCalledWith(
			"transcribe",
			[],
			onVoiceImage,
			9,
			{ text: "previous voice" },
			{
				telegramBotId: "bot-a",
				telegramUserId: undefined,
			},
		);

		const audioCtx = {
			api: {
				getFile: mock(async (_fileId: string) => ({
					file_path: "audio/file_1.mp3",
				})),
			},
			chat: { id: 10 },
			message: {
				audio: {
					file_id: "audio-1",
					file_name: "song.mp3",
					file_size: 2048,
					mime_type: "audio/mpeg",
					duration: 95,
					caption: "summarize this",
				},
			},
			reply: mock(async () => undefined),
			replyWithChatAction: mock(async () => undefined),
			replyWithPhoto: mock(async () => undefined),
		};
		await bot.handlers.get("message:audio")?.(audioCtx);
		expect(handleTelegramVoiceMessage).toHaveBeenCalledTimes(2);
		const audioHandlerCtx = lastVoiceMessageArgs[0] as {
			getFile: () => Promise<unknown>;
		};
		await audioHandlerCtx.getFile();
		expect(audioCtx.api.getFile).toHaveBeenCalledWith("audio-1");

		await service.sendCronResult({
			jobName: "nightly",
			telegramChatId: 9,
			text: "done",
		});
		expect(bot.api.sendMessage).toHaveBeenCalledWith(
			9,
			"[cron] nightly\ndone",
			{
				parse_mode: "HTML",
				disable_notification: true,
			},
		);
		await service.sendCronResult({
			jobName: "heartbeat",
			telegramChatId: 11,
			text: "   ",
		});
		expect(bot.api.sendMessage).toHaveBeenCalledWith(11, "[cron] heartbeat", {
			parse_mode: "HTML",
			disable_notification: true,
		});

		await service.sendHeartbeatResult({
			telegramChatId: 5,
			text: "heartbeat",
			images: [{ path: "/tmp/chart.png", caption: "Chart" }],
		});
		expect(sendTelegramHeartbeatResult).toHaveBeenCalledTimes(1);
		const heartbeatTransport = lastHeartbeatArgs[0] as {
			sendMessage: (
				chatId: number,
				text: string,
				options?: object,
			) => Promise<unknown>;
			sendPhoto: (
				chatId: number,
				path: string,
				options?: object,
			) => Promise<unknown>;
		};
		const heartbeatParams = lastHeartbeatArgs[1] as {
			rememberMessageFile?: unknown;
		};
		expect(heartbeatParams.rememberMessageFile).toBe(rememberMessageFile);
		await heartbeatTransport.sendMessage(5, "ping", {
			disable_notification: true,
		});
		expect(bot.api.sendMessage).toHaveBeenCalledWith(5, "ping", {
			disable_notification: true,
		});
		await heartbeatTransport.sendPhoto(5, "/tmp/chart.png", {
			caption: "Chart",
		});
		const photoArg = bot.api.sendPhoto.mock.calls.at(-1)?.[1] as FakeInputFile;
		expect(photoArg).toBeInstanceOf(FakeInputFile);
		expect(photoArg.path).toBe("/tmp/chart.png");

		service.stop();
		expect(bot.stop).toHaveBeenCalledTimes(1);
		expect(bridge.close).toHaveBeenCalledTimes(1);
	});

	test("logs failure to leave a non-private chat but still skips processing", async () => {
		const error = mock(() => undefined);
		const service = startTelegramBot(
			{
				botId: "bot-a",
				token: "telegram-token",
				runtimeUrl: "ws://runtime",
				allowedUsers: [],
				filesRoot: "/tmp/files",
			},
			createTestDependencies({ logError: error }),
		);

		const bot = FakeBot.lastInstance as FakeBot;
		bot.api.leaveChat = mock(async () => {
			throw new Error("forbidden");
		});

		const groupBlockerMiddleware = bot.middleware[0] as (
			ctx: { chat?: { id: number; type: string } },
			next: () => Promise<unknown>,
		) => Promise<unknown>;
		const next = mock(async () => "should-not-run");
		await expect(
			groupBlockerMiddleware({ chat: { id: -500, type: "group" } }, next),
		).resolves.toBeUndefined();
		expect(next).not.toHaveBeenCalled();
		expect(error).toHaveBeenCalledWith(
			"Failed to leave non-private Telegram chat -500: forbidden",
		);

		service.stop();
	});

	test("logs command registration failures", async () => {
		const error = mock(() => undefined);
		setMyCommandsImpl = async () => {
			throw new Error("boom");
		};

		const service = startTelegramBot(
			{
				botId: "bot-a",
				token: "telegram-token",
				runtimeUrl: "ws://runtime",
				allowedUsers: [],
				filesRoot: "/tmp/files",
			},
			createTestDependencies({ logError: error }),
		);

		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(error).toHaveBeenCalledWith(
			"Failed to register Telegram commands: boom",
		);

		service.stop();
	});
});
