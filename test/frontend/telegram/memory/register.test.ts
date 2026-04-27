import { describe, expect, mock, test } from "bun:test";
import {
	handleTelegramMemoryTextCommand,
	registerTelegramMemoryHandlers,
	TELEGRAM_MEMORY_COMMANDS,
} from "../../../../src/frontend/telegram/memory/register.ts";

describe("Telegram memory file handlers", () => {
	test("advertised memory commands use Telegram-safe command names", () => {
		expect(TELEGRAM_MEMORY_COMMANDS.map((command) => command.command)).toEqual([
			"notes",
			"schema",
			"daily_memories",
			"working_files",
		]);
	});

	test("the /notes command shows a keyboard menu for runtime memory files", async () => {
		let commandHandler:
			| ((ctx: {
					match?: string;
					reply(text: string, options?: object): Promise<unknown>;
			  }) => Promise<void>)
			| undefined;

		const registrar = {
			command: (
				command: string,
				handler: (ctx: {
					match?: string;
					reply(text: string, options?: object): Promise<unknown>;
				}) => Promise<void>,
			) => {
				if (command === "notes") {
					commandHandler = handler;
				}
			},
			callbackQuery: () => {},
		};
		const bridge = {
			sendCommandAndWait: mock(async () => ({
				type: "memory_file_menu",
				command: "notes",
				title: "Notes",
				rootPath: "notes",
				files: [{ id: "abc123", name: "todo.md", path: "notes/todo.md" }],
			})),
		};

		registerTelegramMemoryHandlers(registrar, () => bridge);

		const reply = mock(async (_text: string, _options?: object) => undefined);
		await commandHandler?.({ reply });

		expect(bridge.sendCommandAndWait).toHaveBeenCalledWith(
			"/notes",
			expect.any(Set),
		);
		expect(reply.mock.calls[0]?.[0]).toBe("Notes:");
		expect(
			(
				reply.mock.calls[0]?.[1] as {
					reply_markup?: { inline_keyboard?: unknown[] };
				}
			).reply_markup?.inline_keyboard,
		).toEqual([[{ text: "todo.md", callback_data: "mf:n:abc123" }], []]);
	});

	test("the memory callback asks the runtime for content and sends it as HTML", async () => {
		let callbackHandler:
			| ((ctx: {
					callbackQuery: { data: string };
					answerCallbackQuery(text: string): Promise<unknown>;
					reply(text: string, options?: object): Promise<unknown>;
			  }) => Promise<void>)
			| undefined;

		const registrar = {
			command: () => {},
			callbackQuery: (
				_pattern: RegExp,
				handler: (ctx: {
					callbackQuery: { data: string };
					answerCallbackQuery(text: string): Promise<unknown>;
					reply(text: string, options?: object): Promise<unknown>;
				}) => Promise<void>,
			) => {
				callbackHandler = handler;
			},
		};
		const bridge = {
			sendCommandAndWait: mock(async () => ({
				type: "memory_file_content",
				command: "notes",
				name: "todo.md",
				path: "notes/todo.md",
				content: "# Todo\n- follow up\n",
			})),
		};

		registerTelegramMemoryHandlers(registrar, () => bridge);

		const answerCallbackQuery = mock(async (_text: string) => undefined);
		const reply = mock(async (_text: string, _options?: object) => undefined);
		await callbackHandler?.({
			callbackQuery: { data: "mf:n:abc123" },
			answerCallbackQuery,
			reply,
		});

		expect(bridge.sendCommandAndWait).toHaveBeenCalledWith(
			"/notes abc123",
			expect.any(Set),
		);
		expect(answerCallbackQuery).toHaveBeenCalledWith("Opened notes/todo.md");
		expect(reply.mock.calls[0]?.[0]).toContain("<b>notes/todo.md</b>");
		expect(reply.mock.calls[0]?.[0]).toContain("<b>Todo</b>");
		expect(reply.mock.calls[0]?.[1]).toEqual({
			parse_mode: "HTML",
			disable_notification: true,
		});
	});

	test("exact hyphen text commands are handled before prompt streaming", async () => {
		const bridge = {
			sendCommandAndWait: mock(async () => ({
				type: "memory_file_menu",
				command: "daily-memories",
				title: "Daily Memories",
				rootPath: "daily-memories",
				files: [],
			})),
		};
		const reply = mock(async (_text: string, _options?: object) => undefined);

		const handled = await handleTelegramMemoryTextCommand(
			{
				message: { text: "/daily-memories" },
				reply,
			},
			() => bridge,
		);

		expect(handled).toBe(true);
		expect(bridge.sendCommandAndWait).toHaveBeenCalledWith(
			"/daily-memories",
			expect.any(Set),
		);
		expect(reply).toHaveBeenCalledWith("No files in daily-memories/");
	});
});
