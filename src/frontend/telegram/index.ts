import { autoRetry } from "@grammyjs/auto-retry";
import { type StreamFlavor, stream } from "@grammyjs/stream";
import { Bot, type Context } from "grammy";
import { MODEL_ALIAS_LIST } from "../../common/commands.ts";
import type { ImageRef } from "../../common/protocol.ts";
import { extractError } from "../../common/protocol.ts";
import { createTelegramBridge } from "./bridge.ts";
import { TELEGRAM_COMMANDS } from "./commands.ts";
import { handleTelegramPhotoMessage } from "./photo-message.ts";
import { registerTelegramRuntimeCommands } from "./runtime-commands.ts";
import { handleTelegramTextMessage } from "./text-message.ts";

type MyContext = StreamFlavor<Context>;

interface TelegramBotOptions {
	token: string;
	runtimeUrl: string;
	allowedUsers: number[];
	mediaRoot: string;
	resolveMessageImage?: (
		chatId: number,
		messageId: number,
	) => Promise<ImageRef | undefined>;
	rememberMessageImage?: (params: {
		chatId: number;
		messageId: number;
		image: ImageRef;
		direction: "inbound" | "outbound";
	}) => Promise<void>;
}

export function startTelegramBot({
	token,
	runtimeUrl,
	allowedUsers,
	mediaRoot,
	resolveMessageImage,
	rememberMessageImage,
}: TelegramBotOptions) {
	const bot = new Bot<MyContext>(token);
	bot.api.config.use(autoRetry());
	bot.use(stream());

	const allowed = new Set(allowedUsers);
	bot.use(async (ctx, next) => {
		if (ctx.from && allowed.has(ctx.from.id)) {
			return next();
		}
	});

	const bridge = createTelegramBridge(runtimeUrl);

	void bot.api.setMyCommands(TELEGRAM_COMMANDS).catch((err) => {
		console.error(`Failed to register Telegram commands: ${extractError(err)}`);
	});

	registerTelegramRuntimeCommands(bot, bridge);

	const modelExpectedTypes = new Set(["model_changed"]);
	for (const alias of MODEL_ALIAS_LIST) {
		bot.command(alias, async (ctx) => {
			const event = await bridge.sendCommandAndWait(
				`/${alias}`,
				modelExpectedTypes,
			);
			if (event.type === "model_changed") {
				await ctx.reply(`Model: ${event.model}`);
			}
		});
	}

	bot.on("message:text", async (ctx) => {
		await handleTelegramTextMessage(
			{
				chat: ctx.chat,
				message: ctx.message,
				reply: (text) => ctx.reply(text),
				replyWithChatAction: (action) => ctx.replyWithChatAction(action),
				replyWithPhoto: (photo, options) => ctx.replyWithPhoto(photo, options),
				replyWithStream: (iterable, placeholder, options) =>
					ctx.replyWithStream(iterable, placeholder, options),
			},
			{
				resolveMessageImage,
				rememberMessageImage,
				streamPrompt: (prompt, images, onImage) =>
					bridge.stream(prompt, images, onImage),
			},
		);
	});

	bot.on("message:photo", async (ctx) => {
		const largestPhoto = ctx.message.photo.at(-1);
		if (!largestPhoto) {
			await ctx.reply("[error] Telegram photo message is missing photo sizes");
			return;
		}

		await handleTelegramPhotoMessage(
			{
				chat: ctx.chat,
				getFile: () => ctx.api.getFile(largestPhoto.file_id),
				message: ctx.message,
				reply: (text) => ctx.reply(text),
				replyWithChatAction: (action) => ctx.replyWithChatAction(action),
				replyWithPhoto: (photo, options) => ctx.replyWithPhoto(photo, options),
				replyWithStream: (iterable, placeholder, options) =>
					ctx.replyWithStream(iterable, placeholder, options),
			},
			{
				resolveMessageImage,
				rememberMessageImage,
				token,
				mediaRoot,
				streamPrompt: (prompt, images, onImage) =>
					bridge.stream(prompt, images, onImage),
			},
		);
	});

	bot.start();

	console.log("Telegram bot started");

	return {
		stop() {
			bot.stop();
			bridge.close();
		},
	};
}
