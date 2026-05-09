import { InlineKeyboard } from "grammy";
import {
	buildSessionCommandRequest,
	formatSessionCommandReply,
	sessionFetchLimitForPage,
} from "./command.ts";
import {
	buildSessionPageView,
	extractSearchQueryFromSessionPageText,
	parseSessionCallback,
} from "./menu.ts";

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
				options?: { parse_mode?: "HTML"; reply_markup?: InlineKeyboard },
			): Promise<unknown>;
		}) => Promise<void>,
	): unknown;
	callbackQuery(
		pattern: RegExp,
		handler: (ctx: {
			callbackQuery: { data: string };
			from?: { id: number };
			answerCallbackQuery(text?: string): Promise<unknown>;
			editMessageText(
				text: string,
				options?: { parse_mode?: "HTML"; reply_markup?: InlineKeyboard },
			): Promise<unknown>;
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

		if (!isSessionPageEvent(event)) {
			const reply = formatSessionCommandReply(event);
			if (reply) {
				await ctx.reply(reply);
			}
			return;
		}

		const view = buildSessionPageView({
			activeSessionId: event.activeSessionId as string | undefined,
			mode: request.renderMode ?? "list",
			nextCursor: event.nextCursor,
			page: 0,
			query:
				request.searchQuery ??
				(event.type === "session_search_result"
					? String(event.query ?? "")
					: undefined),
			sessions: event.sessions as Array<{
				sdkSessionId: string;
				title: string;
				lastActive: number;
			}>,
		});
		await ctx.reply(view.text, {
			parse_mode: "HTML",
			reply_markup: buildInlineKeyboard(view.rows),
		});
	});

	registrar.callbackQuery(/^(ss:|sl:|sq:|sn$)/, async (ctx) => {
		const bridge = createBridge(ctx);
		const action = parseSessionCallback(ctx.callbackQuery.data);
		if (!action) {
			return;
		}
		if (action.type === "noop") {
			await ctx.answerCallbackQuery();
			return;
		}
		if (action.type === "page") {
			const page = action.page ?? 0;
			const query =
				action.mode === "search"
					? extractSearchQueryFromSessionPageText(
							(ctx.callbackQuery as { message?: { text?: string } }).message
								?.text,
						)
					: undefined;
			if (action.mode === "search" && !query) {
				await ctx.answerCallbackQuery("Search query expired");
				return;
			}
			const event =
				action.mode === "search"
					? await bridge.sendCommandAndWait(
							`/session search --limit ${sessionFetchLimitForPage(page)} -- ${query}`,
							new Set(["session_search_result"]),
						)
					: await bridge.sendCommandAndWait(
							`/session list ${sessionFetchLimitForPage(page)}`,
							new Set(["session_list"]),
						);
			if (!isSessionPageEvent(event)) {
				await ctx.answerCallbackQuery(
					formatSessionCommandReply(event) ?? String(event.message ?? "Error"),
				);
				return;
			}
			if (
				action.mode === "search" &&
				event.type === "session_search_result" &&
				event.query !== query
			) {
				await ctx.answerCallbackQuery("Ignored stale search result");
				return;
			}
			const view = buildSessionPageView({
				activeSessionId: event.activeSessionId as string | undefined,
				mode: action.mode ?? "list",
				nextCursor: event.nextCursor,
				page,
				query,
				sessions: event.sessions as Array<{
					sdkSessionId: string;
					title: string;
					lastActive: number;
				}>,
			});
			await ctx.editMessageText(view.text, {
				parse_mode: "HTML",
				reply_markup: buildInlineKeyboard(view.rows),
			});
			await ctx.answerCallbackQuery(`Page ${page + 1}`);
			return;
		}
		if (action.type !== "switch" || !action.sdkSessionId) {
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

function buildInlineKeyboard(
	rows: Array<Array<{ label: string; data: string }>>,
): InlineKeyboard {
	const keyboard = new InlineKeyboard();
	for (const [rowIndex, row] of rows.entries()) {
		for (const button of row) {
			keyboard.text(button.label, button.data);
		}
		if (rowIndex < rows.length - 1) {
			keyboard.row();
		}
	}
	return keyboard;
}

function isSessionPageEvent(event: {
	type: string;
	[key: string]: unknown;
}): event is {
	type: "session_list" | "session_menu" | "session_search_result";
	activeSessionId?: string;
	nextCursor?: unknown;
	query?: string;
	sessions: unknown[];
} {
	return (
		(event.type === "session_list" ||
			event.type === "session_menu" ||
			event.type === "session_search_result") &&
		Array.isArray(event.sessions)
	);
}
