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

	bot.command("session", async (ctx) => {
		const arg = ctx.match?.trim();
		const command = arg ? `/session ${arg}` : "/session";
		const event = await bridge.sendCommandAndWait(command);
		if (event.type === "session_info") {
			await ctx.reply(
				`Session: ${event.sdkSessionId}\nTitle: ${event.title}\nModel: ${event.model}`,
			);
		} else if (event.type === "session_list") {
			const list = (
				event.sessions as Array<{
					sdkSessionId: string;
					title: string;
				}>
			)
				.map((s) => `${s.sdkSessionId.slice(0, 8)}  ${s.title}`)
				.join("\n");
			await ctx.reply(list || "No sessions");
		} else if (event.type === "session_switched") {
			await ctx.reply(`Switched to: ${event.title}`);
		} else if (event.type === "error") {
			await ctx.reply(`[error] ${event.message}`);
		}
	});

	bot.command("status", async (ctx) => {
		const event = await bridge.sendCommandAndWait("/status");
		if (event.type === "runtime_status") {
			const u = event.usage as
				| { contextTokens: number; contextWindow: number; percentage: number }
				| undefined;
			const ctx_info = u
				? `${(u.contextTokens as number).toLocaleString()}/${(u.contextWindow as number).toLocaleString()} (${u.percentage}%)`
				: "n/a";
			await ctx.reply(
				`Model: ${event.model}\nEffort: ${event.effort}\nSession: ${event.sessionId ?? "none"}\nContext: ${ctx_info}`,
			);
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
