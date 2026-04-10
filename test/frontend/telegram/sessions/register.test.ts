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
				activeSessionId: "sdk-1",
				sessions: [
					{ sdkSessionId: "sdk-1", title: "Alpha", lastActive: 1 },
					{ sdkSessionId: "sdk-2", title: "Beta", lastActive: 2 },
				],
			})),
		};

		registerTelegramSessionHandlers(registrar, bridge);

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
		expect(reply.mock.calls[0]?.[0]).toBe("Sessions:");
		expect(
			(
				reply.mock.calls[0]?.[1] as {
					reply_markup?: { inline_keyboard?: unknown[] };
				}
			).reply_markup?.inline_keyboard,
		).toEqual([
			[{ text: "Alpha ●", callback_data: "ss:sdk-1" }],
			[{ text: "Beta", callback_data: "ss:sdk-2" }],
			[],
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

		registerTelegramSessionHandlers(registrar, bridge);

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

		registerTelegramSessionHandlers(registrar, bridge);

		const answerCallbackQuery = mock(async (_text: string) => undefined);
		const editMessageText = mock(async (_text: string) => undefined);
		await callbackHandler?.({
			callbackQuery: { data: "ss:sdk-2" },
			answerCallbackQuery,
			editMessageText,
		});

		expect(bridge.sendCommandAndWait).toHaveBeenCalledWith(
			"/session sdk-2",
			expect.any(Set),
		);
		expect(answerCallbackQuery).toHaveBeenCalledWith("Switched to: Beta");
		expect(editMessageText).toHaveBeenCalledWith("Switched to: Beta");
	});
});
