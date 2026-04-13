import { describe, expect, mock, test } from "bun:test";
import { PROMPT_COMMANDS } from "../../../../src/common/commands.ts";
import {
	registerTelegramPromptCommands,
	TELEGRAM_PROMPT_COMMANDS,
} from "../../../../src/frontend/telegram/commands/prompt.ts";

describe("Telegram prompt commands", () => {
	test("advertised commands cover all prompt slash commands", () => {
		const advertised = new Set(TELEGRAM_PROMPT_COMMANDS.map((c) => c.command));
		for (const command of PROMPT_COMMANDS) {
			expect(advertised.has(command.command)).toBe(true);
		}
	});

	test("registerTelegramPromptCommands wires /compact through the prompt stream", async () => {
		const handlers = new Map<
			string,
			(ctx: {
				chat: { id: number };
				replyWithChatAction(action: "typing"): Promise<unknown>;
				replyWithPhoto(
					photo: unknown,
					options: object,
				): Promise<{ message_id: number }>;
				sendMessage(
					text: string,
					options: object,
				): Promise<{ message_id: number }>;
				editMessageText(
					messageId: number,
					text: string,
					options: object,
				): Promise<unknown>;
			}) => Promise<void>
		>();
		const registrar = {
			command: (
				command: string,
				handler: (ctx: {
					chat: { id: number };
					replyWithChatAction(action: "typing"): Promise<unknown>;
					replyWithPhoto(
						photo: unknown,
						options: object,
					): Promise<{ message_id: number }>;
					sendMessage(
						text: string,
						options: object,
					): Promise<{ message_id: number }>;
					editMessageText(
						messageId: number,
						text: string,
						options: object,
					): Promise<unknown>;
				}) => Promise<void>,
			) => {
				handlers.set(command, handler);
			},
		};

		const stream = mock(
			(
				_prompt: string,
				_images?: unknown[],
				_onImage?: unknown,
				_chatId?: number,
				_replyContext?: unknown,
			) =>
				(async function* () {
					yield { type: "compacting_started" as const };
					yield { type: "compacting_finished" as const };
				})(),
		);
		registerTelegramPromptCommands(registrar, { stream });

		const sendMessage = mock(async (_text: string, _options: object) => ({
			message_id: 1,
		}));
		await handlers.get("compact")?.({
			chat: { id: 42 },
			replyWithChatAction: mock(async (_action: "typing") => undefined),
			replyWithPhoto: mock(async (_photo: unknown, _options: object) => ({
				message_id: 2,
			})),
			sendMessage,
			editMessageText: mock(
				async (_messageId: number, _text: string, _options: object) =>
					undefined,
			),
		});

		const [prompt, images, onImage, chatId, replyContext] =
			stream.mock.calls[0] ?? [];
		expect(prompt).toBe("/compact");
		expect(images).toBeUndefined();
		expect(typeof onImage).toBe("function");
		expect(chatId).toBe(42);
		expect(replyContext).toBeUndefined();
		expect(sendMessage.mock.calls[0]?.[0]).toBe("Compacting context...");
		expect(sendMessage.mock.calls[1]?.[0]).toBe("Context compacted.");
	});
});
