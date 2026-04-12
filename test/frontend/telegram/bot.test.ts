import { afterEach, describe, expect, mock, test } from "bun:test";
import { startTelegramBot } from "../../../src/frontend/telegram/bot.ts";
import { TELEGRAM_COMMANDS } from "../../../src/frontend/telegram/commands/catalog.ts";

const autoRetryMiddleware = Symbol("autoRetry");

function createEmptyTextStream() {
	return (async function* () {})();
}

let bridge = {
	close: mock(() => {}),
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
let registerTelegramModelShortcuts = mock(() => {});
let lastHeartbeatArgs: unknown[] = [];
let lastTextMessageArgs: unknown[] = [];
let lastPhotoMessageArgs: unknown[] = [];
let lastDocumentMessageArgs: unknown[] = [];
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
let setMyCommandsImpl: (commands: unknown) => Promise<unknown> = async (
	_commands: unknown,
) => undefined;

class FakeInputFile {
	constructor(readonly path: string) {}
}

class FakeBot {
	static lastInstance: FakeBot | undefined;

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
		_command: string,
		_handler: (ctx: Record<string, unknown>) => Promise<void>,
	) {
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
	registerTelegramModelShortcuts = mock(() => {});
	lastHeartbeatArgs = [];
	lastTextMessageArgs = [];
	lastPhotoMessageArgs = [];
	lastDocumentMessageArgs = [];
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
		expect(registerTelegramSessionHandlers).toHaveBeenCalledWith(bot, bridge);
		expect(registerTelegramRuntimeCommands).toHaveBeenCalledWith(bot, bridge);
		expect(registerTelegramModelShortcuts).toHaveBeenCalledWith(bot, bridge);
		expect(bot.start).toHaveBeenCalledTimes(1);
		expect(log).toHaveBeenCalledWith("Telegram bot started");

		const authMiddleware = bot.middleware[0] as (
			ctx: { from?: { id: number } },
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
		expect(bridge.stream).toHaveBeenCalledWith("hello", [], onTextImage, 42, {
			text: "previous message",
		});

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
		expect(bridge.stream).toHaveBeenCalledWith("plot", [], onPhotoImage, 7, {
			text: "previous photo",
		});

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
		);

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

	test("logs command registration failures", async () => {
		const error = mock(() => undefined);
		setMyCommandsImpl = async () => {
			throw new Error("boom");
		};

		const service = startTelegramBot(
			{
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
