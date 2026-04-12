import { describe, expect, mock, test } from "bun:test";
import { handleTelegramTextMessage } from "../../../../src/frontend/telegram/messages/text.ts";

function createTextContext(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		chat: { id: 123 },
		message: {
			text: "hello",
			message_id: 100,
			...(overrides.message as object),
		},
		reply: mock(async (_text: string) => undefined),
		replyWithChatAction: mock(async (_action: string) => undefined),
		replyWithPhoto: mock(async (_photo: unknown, _options: unknown) => ({
			message_id: 77,
		})),
		sendMessage: mock(async (_text: string, _options: object) => ({
			message_id: 10,
		})),
		editMessageText: mock(
			async (_messageId: number, _text: string, _options: object) => {},
		),
		...overrides,
	};
}

describe("handleTelegramTextMessage", () => {
	test("reattaches the replied-to image for a text prompt", async () => {
		const resolveMessageImage = mock(
			async (chatId: number, messageId: number) => {
				expect(chatId).toBe(123);
				expect(messageId).toBe(99);
				return { path: "/tmp/replied.png", mediaType: "image/png" as const };
			},
		);
		const rememberMessageImage = mock(async () => {});
		const streamPrompt = mock(
			(
				_prompt: string,
				_images?: Array<{ path: string; mediaType: string }>,
				_onImage?: (event: { type: "image"; path: string }) => void,
			) =>
				(async function* () {
					yield { type: "text" as const, text: "done" };
				})(),
		);

		const ctx = createTextContext({
			message: {
				text: "use that image again",
				message_id: 100,
				reply_to_message: { message_id: 99 },
			},
		});

		await handleTelegramTextMessage(ctx, {
			resolveMessageImage,
			rememberMessageImage,
			streamPrompt,
		});

		expect(streamPrompt).toHaveBeenCalledWith(
			"use that image again",
			[{ path: "/tmp/replied.png", mediaType: "image/png" }],
			expect.any(Function),
			undefined,
		);
	});

	test("stores outbound image refs using the sent telegram message id", async () => {
		const rememberMessageImage = mock(async () => {});
		const ctx = createTextContext({
			chat: { id: 321 },
			message: { text: "plot", message_id: 10 },
			replyWithPhoto: mock(async (_photo: unknown, _options: unknown) => ({
				message_id: 88,
			})),
		});

		await handleTelegramTextMessage(ctx, {
			rememberMessageImage,
			streamPrompt: (_prompt, _images, onImage) =>
				(async function* () {
					await onImage?.({
						type: "image",
						path: "/tmp/chart.png",
					});
					yield { type: "text" as const, text: "done" };
				})(),
		});

		expect(rememberMessageImage).toHaveBeenCalledWith({
			chatId: 321,
			messageId: 88,
			image: { path: "/tmp/chart.png", mediaType: "image/png" },
			direction: "outbound",
		});
	});

	test("appends replied-to text context to prompt", async () => {
		const streamPrompt = mock(
			(
				_prompt: string,
				_images?: Array<{ path: string; mediaType: string }>,
				_onImage?: (event: { type: "image"; path: string }) => void,
			) =>
				(async function* () {
					yield { type: "text" as const, text: "done" };
				})(),
		);

		const ctx = createTextContext({
			message: {
				text: "what do you mean?",
				message_id: 100,
				reply_to_message: { message_id: 99, text: "the cron output" },
			},
		});

		await handleTelegramTextMessage(ctx, { streamPrompt });

		expect(streamPrompt).toHaveBeenCalledWith(
			"what do you mean?",
			[],
			expect.any(Function),
			{ text: "the cron output" },
		);
	});

	test("passes reply context separately without mutating the prompt text", async () => {
		const streamPrompt = mock(
			(
				_prompt: string,
				_images?: Array<{ path: string; mediaType: string }>,
				_onImage?: (event: { type: "image"; path: string }) => void,
				_replyContext?: { text: string },
			) =>
				(async function* () {
					yield { type: "text" as const, text: "done" };
				})(),
		);

		const ctx = createTextContext({
			message: {
				text: "why?",
				message_id: 100,
				reply_to_message: { message_id: 99, text: 'the "cron" output' },
			},
		});

		await handleTelegramTextMessage(ctx, { streamPrompt });

		expect(streamPrompt).toHaveBeenCalledWith(
			"why?",
			[],
			expect.any(Function),
			{ text: 'the "cron" output' },
		);
	});

	test("passes original prompt when reply has no text", async () => {
		const streamPrompt = mock(
			(
				_prompt: string,
				_images?: Array<{ path: string; mediaType: string }>,
				_onImage?: (event: { type: "image"; path: string }) => void,
			) =>
				(async function* () {
					yield { type: "text" as const, text: "done" };
				})(),
		);

		const ctx = createTextContext({
			message: {
				text: "hello",
				message_id: 100,
				reply_to_message: { message_id: 99 },
			},
		});

		await handleTelegramTextMessage(ctx, { streamPrompt });

		expect(streamPrompt).toHaveBeenCalledWith(
			"hello",
			[],
			expect.any(Function),
			undefined,
		);
	});

	test("reports an error when prompt execution fails", async () => {
		const ctx = createTextContext({
			chat: { id: 321 },
			message: { text: "plot", message_id: 10 },
		});

		await handleTelegramTextMessage(ctx, {
			streamPrompt: () => {
				throw new Error("bridge exploded");
			},
		});

		expect(ctx.reply).toHaveBeenCalledWith("[error] bridge exploded");
	});
});
