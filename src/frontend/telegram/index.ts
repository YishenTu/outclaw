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

	bot.command("model", async (ctx) => {
		const arg = ctx.match?.trim();
		const command = arg ? `/model ${arg}` : "/model";
		const event = await bridge.sendCommandAndWait(command);
		if (event.type === "model_changed") {
			await ctx.reply(`Model: ${event.model}`);
		} else if (event.type === "error") {
			await ctx.reply(`[error] ${event.message}`);
		}
	});

	for (const alias of ["opus", "sonnet", "haiku"]) {
		bot.command(alias, async (ctx) => {
			const event = await bridge.sendCommandAndWait(`/${alias}`);
			if (event.type === "model_changed") {
				await ctx.reply(`Model: ${event.model}`);
			}
		});
	}

	bot.command("thinking", async (ctx) => {
		const arg = ctx.match?.trim();
		const command = arg ? `/thinking ${arg}` : "/thinking";
		const event = await bridge.sendCommandAndWait(command);
		if (event.type === "effort_changed") {
			await ctx.reply(`Thinking effort: ${event.effort}`);
		} else if (event.type === "error") {
			await ctx.reply(`[error] ${event.message}`);
		}
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
