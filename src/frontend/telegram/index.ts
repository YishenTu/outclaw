import { autoRetry } from "@grammyjs/auto-retry";
import { type StreamFlavor, stream } from "@grammyjs/stream";
import { Bot, type Context } from "grammy";
import { MODEL_ALIAS_LIST } from "../../common/commands.ts";
import { extractError } from "../../common/protocol.ts";
import { createTelegramBridge } from "./bridge.ts";
import { TELEGRAM_COMMANDS } from "./commands.ts";
import { registerTelegramRuntimeCommands } from "./runtime-commands.ts";

type MyContext = StreamFlavor<Context>;

interface TelegramBotOptions {
	token: string;
	runtimeUrl: string;
}

export function startTelegramBot({ token, runtimeUrl }: TelegramBotOptions) {
	const bot = new Bot<MyContext>(token);
	bot.api.config.use(autoRetry());
	bot.use(stream());
	const bridge = createTelegramBridge(runtimeUrl);

	void bot.api.setMyCommands(TELEGRAM_COMMANDS).catch((err) => {
		console.error(`Failed to register Telegram commands: ${extractError(err)}`);
	});

	registerTelegramRuntimeCommands(bot, bridge);

	for (const alias of MODEL_ALIAS_LIST) {
		bot.command(alias, async (ctx) => {
			const event = await bridge.sendCommandAndWait(`/${alias}`);
			if (event.type === "model_changed") {
				await ctx.reply(`Model: ${event.model}`);
			}
		});
	}

	bot.on("message:text", async (ctx) => {
		try {
			await ctx.replyWithChatAction("typing");
			const typingInterval = setInterval(() => {
				ctx.replyWithChatAction("typing").catch(() => {});
			}, 4000);
			try {
				await ctx.replyWithStream(bridge.stream(ctx.message.text), undefined, {
					disable_notification: true,
				});
			} finally {
				clearInterval(typingInterval);
			}
		} catch (err) {
			await ctx.reply(`[error] ${extractError(err)}`);
		}
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
