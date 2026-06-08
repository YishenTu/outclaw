import { describe, expect, mock, test } from "bun:test";
import { registerTelegramSessionHandlers } from "../../../../src/frontend/telegram/sessions/register.ts";

describe("Telegram session handler registration", () => {
	test("the /session command shows a keyboard menu when the runtime returns session_menu", async () => {
		let commandHandler:
			| ((ctx: {
					match?: string;
					reply(
						text: string,
						options?: { reply_markup?: { inline_keyboard?: unknown[] } },
					): Promise<unknown>;
			  }) => Promise<void>)
			| undefined;

		const registrar = {
			command: (
				_command: "session",
				handler: (ctx: {
					match?: string;
					reply(
						text: string,
						options?: { reply_markup?: { inline_keyboard?: unknown[] } },
					): Promise<unknown>;
				}) => Promise<void>,
			) => {
				commandHandler = handler;
			},
			callbackQuery: () => {},
		};
		const bridge = {
			sendCommandAndWait: mock(async () => ({
				type: "session_menu",
				activeProviderId: "pi",
				activeSessionId: "sdk-1",
				sessions: [
					{
						providerId: "pi",
						sdkSessionId: "sdk-1",
						title: "Alpha",
						lastActive: 1,
					},
					{
						providerId: "claude",
						sdkSessionId: "sdk-2",
						title: "Beta",
						lastActive: 2,
					},
				],
			})),
		};

		registerTelegramSessionHandlers(registrar, () => bridge);

		const reply = mock(
			async (
				_text: string,
				_options?: { reply_markup?: { inline_keyboard?: unknown[] } },
			) => undefined,
		);
		await commandHandler?.({ reply });

		expect(bridge.sendCommandAndWait).toHaveBeenCalledWith(
			"/session",
			expect.any(Set),
		);
		expect(reply).toHaveBeenCalledTimes(1);
		expect(reply.mock.calls[0]?.[0]).toBe("<b>Sessions:</b>");
		expect(
			(
				reply.mock.calls[0]?.[1] as {
					reply_markup?: { inline_keyboard?: unknown[] };
				}
			).reply_markup?.inline_keyboard,
		).toEqual([
			[{ text: "● Alpha", callback_data: "ss:pi/sdk-1" }],
			[{ text: "Beta", callback_data: "ss:claude/sdk-2" }],
			[{ text: "1/1", callback_data: "sn" }],
		]);
	});

	test("the /session command falls back to a plain reply for non-menu events", async () => {
		let commandHandler:
			| ((ctx: {
					match?: string;
					reply(text: string): Promise<unknown>;
			  }) => Promise<void>)
			| undefined;

		const registrar = {
			command: (
				_command: "session",
				handler: (ctx: {
					match?: string;
					reply(text: string): Promise<unknown>;
				}) => Promise<void>,
			) => {
				commandHandler = handler;
			},
			callbackQuery: () => {},
		};
		const bridge = {
			sendCommandAndWait: mock(async () => ({
				type: "session_switched",
				title: "Recovered chat",
			})),
		};

		registerTelegramSessionHandlers(registrar, () => bridge);

		const reply = mock(async (_text: string) => undefined);
		await commandHandler?.({ reply });

		expect(reply).toHaveBeenCalledWith("Switched to: Recovered chat");
	});

	test("the callback handler switches sessions and edits the menu message", async () => {
		let callbackHandler:
			| ((ctx: {
					callbackQuery: { data: string };
					answerCallbackQuery(text: string): Promise<unknown>;
					editMessageText(text: string): Promise<unknown>;
			  }) => Promise<void>)
			| undefined;

		const registrar = {
			command: () => {},
			callbackQuery: (
				_pattern: RegExp,
				handler: (ctx: {
					callbackQuery: { data: string };
					answerCallbackQuery(text: string): Promise<unknown>;
					editMessageText(text: string): Promise<unknown>;
				}) => Promise<void>,
			) => {
				callbackHandler = handler;
			},
		};
		const bridge = {
			sendCommandAndWait: mock(async () => ({
				type: "session_switched",
				title: "Beta",
			})),
		};

		registerTelegramSessionHandlers(registrar, () => bridge);

		const answerCallbackQuery = mock(async (_text: string) => undefined);
		const editMessageText = mock(async (_text: string) => undefined);
		await callbackHandler?.({
			callbackQuery: { data: "ss:pi/sdk-2" },
			answerCallbackQuery,
			editMessageText,
		});

		expect(bridge.sendCommandAndWait).toHaveBeenCalledWith(
			"/session pi/sdk-2",
			expect.any(Set),
		);
		expect(answerCallbackQuery).toHaveBeenCalledWith("Switched to: Beta");
		expect(editMessageText).toHaveBeenCalledWith("Switched to: Beta");
	});

	test("the page callback fetches and edits the requested list page", async () => {
		let callbackHandler:
			| ((ctx: {
					callbackQuery: { data: string; message?: { text?: string } };
					answerCallbackQuery(text: string): Promise<unknown>;
					editMessageText(
						text: string,
						options?: { reply_markup?: { inline_keyboard?: unknown[] } },
					): Promise<unknown>;
			  }) => Promise<void>)
			| undefined;

		const registrar = {
			command: () => {},
			callbackQuery: (
				_pattern: RegExp,
				handler: (ctx: {
					callbackQuery: { data: string; message?: { text?: string } };
					answerCallbackQuery(text: string): Promise<unknown>;
					editMessageText(
						text: string,
						options?: { reply_markup?: { inline_keyboard?: unknown[] } },
					): Promise<unknown>;
				}) => Promise<void>,
			) => {
				callbackHandler = handler;
			},
		};
		const bridge = {
			sendCommandAndWait: mock(async () => ({
				type: "session_list",
				activeSessionId: "sdk-6",
				sessions: Array.from({ length: 7 }, (_value, index) => ({
					sdkSessionId: `sdk-${index}`,
					title: `Chat ${index}`,
					lastActive: index,
				})),
			})),
		};

		registerTelegramSessionHandlers(registrar, () => bridge);

		const answerCallbackQuery = mock(async (_text: string) => undefined);
		const editMessageText = mock(
			async (
				_text: string,
				_options?: { reply_markup?: { inline_keyboard?: unknown[] } },
			) => undefined,
		);
		await callbackHandler?.({
			callbackQuery: { data: "sl:1" },
			answerCallbackQuery,
			editMessageText,
		});

		expect(bridge.sendCommandAndWait).toHaveBeenCalledWith(
			"/session list 15",
			expect.any(Set),
		);
		expect(editMessageText.mock.calls[0]?.[0]).toBe("<b>Sessions:</b>");
		expect(answerCallbackQuery).toHaveBeenCalledWith("Page 2");
	});

	test("the noop page marker answers silently", async () => {
		let callbackHandler:
			| ((ctx: {
					callbackQuery: { data: string; message?: { text?: string } };
					answerCallbackQuery(text?: string): Promise<unknown>;
					editMessageText(
						text: string,
						options?: { reply_markup?: { inline_keyboard?: unknown[] } },
					): Promise<unknown>;
			  }) => Promise<void>)
			| undefined;

		const registrar = {
			command: () => {},
			callbackQuery: (
				_pattern: RegExp,
				handler: (ctx: {
					callbackQuery: { data: string; message?: { text?: string } };
					answerCallbackQuery(text?: string): Promise<unknown>;
					editMessageText(
						text: string,
						options?: { reply_markup?: { inline_keyboard?: unknown[] } },
					): Promise<unknown>;
				}) => Promise<void>,
			) => {
				callbackHandler = handler;
			},
		};
		const bridge = {
			sendCommandAndWait: mock(async () => ({
				type: "session_list",
				sessions: [],
			})),
		};

		registerTelegramSessionHandlers(registrar, () => bridge);

		const answerCallbackQuery = mock(async (_text?: string) => undefined);
		await callbackHandler?.({
			callbackQuery: { data: "sn" },
			answerCallbackQuery,
			editMessageText: mock(async () => undefined),
		});

		expect(answerCallbackQuery).toHaveBeenCalledWith();
		expect(bridge.sendCommandAndWait).not.toHaveBeenCalled();
	});

	test("the search page callback keeps the query out of callback_data", async () => {
		let callbackHandler:
			| ((ctx: {
					callbackQuery: { data: string; message?: { text?: string } };
					answerCallbackQuery(text: string): Promise<unknown>;
					editMessageText(
						text: string,
						options?: { reply_markup?: { inline_keyboard?: unknown[] } },
					): Promise<unknown>;
			  }) => Promise<void>)
			| undefined;

		const registrar = {
			command: () => {},
			callbackQuery: (
				_pattern: RegExp,
				handler: (ctx: {
					callbackQuery: { data: string; message?: { text?: string } };
					answerCallbackQuery(text: string): Promise<unknown>;
					editMessageText(
						text: string,
						options?: { reply_markup?: { inline_keyboard?: unknown[] } },
					): Promise<unknown>;
				}) => Promise<void>,
			) => {
				callbackHandler = handler;
			},
		};
		const bridge = {
			sendCommandAndWait: mock(async () => ({
				type: "session_search_result",
				query: "auth middleware",
				sessions: [
					{
						sdkSessionId: "sdk-auth",
						title: "Auth middleware",
						lastActive: 1,
					},
				],
			})),
		};

		registerTelegramSessionHandlers(registrar, () => bridge);

		const answerCallbackQuery = mock(async (_text: string) => undefined);
		const editMessageText = mock(
			async (
				_text: string,
				_options?: { reply_markup?: { inline_keyboard?: unknown[] } },
			) => undefined,
		);
		await callbackHandler?.({
			callbackQuery: {
				data: "sq:1",
				message: { text: "Session search: auth middleware\n• first" },
			},
			answerCallbackQuery,
			editMessageText,
		});

		expect(bridge.sendCommandAndWait).toHaveBeenCalledWith(
			"/session search --limit 15 -- auth middleware",
			expect.any(Set),
		);
		expect(editMessageText.mock.calls[0]?.[0]).toStartWith(
			"<b>Session search: auth middleware</b>",
		);
	});
});
