import { Bot } from "grammy";
import { createTelegramBridge } from "./telegram-bridge.ts";

interface TelegramBotOptions {
	token: string;
	runtimeUrl: string;
}

export function startTelegramBot({ token, runtimeUrl }: TelegramBotOptions) {
	const bot = new Bot(token);
	const bridge = createTelegramBridge(runtimeUrl);

	bot.on("message:text", async (ctx) => {
		try {
			const response = await bridge.send(ctx.message.text);
			const chunks = bridge.chunk(response);

			for (const chunk of chunks) {
				await ctx.reply(chunk);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			await ctx.reply(`[error] ${message}`);
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
