import { InlineKeyboard } from "grammy";
import {
	buildSessionCommandRequest,
	formatSessionCommandReply,
} from "./command.ts";
import { buildSessionButtons, parseSessionCallback } from "./menu.ts";

interface TelegramSessionBridge {
	sendCommandAndWait(
		command: string,
		expectedTypes?: ReadonlySet<string>,
	): Promise<{ type: string; [key: string]: unknown }>;
}

interface TelegramSessionRegistrar {
	command(
		command: "session",
		handler: (ctx: {
			from?: { id: number };
			match?: string;
			reply(
				text: string,
				options?: { reply_markup?: InlineKeyboard },
			): Promise<unknown>;
		}) => Promise<void>,
	): unknown;
	callbackQuery(
		pattern: RegExp,
		handler: (ctx: {
			callbackQuery: { data: string };
			from?: { id: number };
			answerCallbackQuery(text: string): Promise<unknown>;
			editMessageText(text: string): Promise<unknown>;
		}) => Promise<void>,
	): unknown;
}

type TelegramSessionBridgeFactory = (
	ctx:
		| {
				from?: { id: number };
				match?: string;
		  }
		| {
				callbackQuery: { data: string };
				from?: { id: number };
		  },
) => TelegramSessionBridge;

export function registerTelegramSessionHandlers(
	registrar: TelegramSessionRegistrar,
	createBridge: TelegramSessionBridgeFactory,
) {
	registrar.command("session", async (ctx) => {
		const bridge = createBridge(ctx);
		const request = buildSessionCommandRequest(ctx.match);
		const event = await bridge.sendCommandAndWait(
			request.command,
			request.expectedTypes,
		);

		if (!request.showMenu) {
			const reply = formatSessionCommandReply(event);
			if (reply) {
				await ctx.reply(reply);
			}
			return;
		}

		if (event.type !== "session_menu") {
			const reply = formatSessionCommandReply(event);
			if (reply) {
				await ctx.reply(reply);
			}
			return;
		}

		const sessions = event.sessions as Array<{
			sdkSessionId: string;
			title: string;
			lastActive: number;
		}>;
		if (sessions.length === 0) {
			await ctx.reply("No sessions");
			return;
		}

		const keyboard = new InlineKeyboard();
		for (const row of buildSessionButtons(
			sessions,
			event.activeSessionId as string | undefined,
		)) {
			keyboard.text(row.label, row.switchData).row();
		}

		await ctx.reply("Sessions:", { reply_markup: keyboard });
	});

	registrar.callbackQuery(/^ss:/, async (ctx) => {
		const bridge = createBridge(ctx);
		const action = parseSessionCallback(ctx.callbackQuery.data);
		if (!action || action.type !== "switch") {
			return;
		}

		const request = buildSessionCommandRequest(action.sdkSessionId);
		const event = await bridge.sendCommandAndWait(
			request.command,
			request.expectedTypes,
		);
		if (event.type === "session_switched") {
			await ctx.answerCallbackQuery(`Switched to: ${String(event.title)}`);
			await ctx.editMessageText(`Switched to: ${String(event.title)}`);
			return;
		}

		await ctx.answerCallbackQuery(
			formatSessionCommandReply(event) ?? String(event.message ?? "Error"),
		);
	});
}
