import { Bot } from "grammy";
import { extractError } from "../../common/protocol.ts";
import { createTelegramBridge } from "./bridge.ts";
import { TELEGRAM_COMMANDS } from "./commands.ts";

interface TelegramBotOptions {
	token: string;
	runtimeUrl: string;
}

export function startTelegramBot({ token, runtimeUrl }: TelegramBotOptions) {
	const bot = new Bot(token);
	const bridge = createTelegramBridge(runtimeUrl);

	bot.api.setMyCommands(TELEGRAM_COMMANDS);

	bot.command("new", async (ctx) => {
		bridge.sendCommand("/new");
		await ctx.reply("Session cleared. Starting fresh.");
	});

	bot.on("message:text", async (ctx) => {
		try {
			const response = await bridge.send(ctx.message.text);
			const chunks = bridge.chunk(response);

			for (const chunk of chunks) {
				await ctx.reply(chunk);
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
