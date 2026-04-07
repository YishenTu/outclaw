import { describe, expect, mock, test } from "bun:test";
import { handleTelegramTextMessage } from "../../src/frontend/telegram/text-message.ts";

describe("handleTelegramTextMessage", () => {
	test("reattaches the replied-to image for a text prompt", async () => {
		const replyWithPhoto = mock(async (_photo: unknown, _options: unknown) => ({
			message_id: 77,
		}));
		const replyWithStream = mock(
			async (
				iterable: AsyncIterable<string>,
				_placeholder: unknown,
				_options: unknown,
			) => {
				for await (const _chunk of iterable) {
					// Drain
				}
			},
		);
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
					yield "done";
				})(),
		);

		await handleTelegramTextMessage(
			{
				chat: { id: 123 },
				message: {
					text: "use that image again",
					message_id: 100,
					reply_to_message: { message_id: 99 },
				},
				reply: async (_text: string) => undefined,
				replyWithChatAction: async (_action: string) => undefined,
				replyWithPhoto,
				replyWithStream,
			},
			{
				resolveMessageImage,
				rememberMessageImage,
				streamPrompt,
			},
		);

		expect(streamPrompt).toHaveBeenCalledWith(
			"use that image again",
			[{ path: "/tmp/replied.png", mediaType: "image/png" }],
			expect.any(Function),
		);
	});

	test("stores outbound image refs using the sent telegram message id", async () => {
		const replyWithPhoto = mock(async (_photo: unknown, _options: unknown) => ({
			message_id: 88,
		}));
		const rememberMessageImage = mock(async () => {});

		await handleTelegramTextMessage(
			{
				chat: { id: 321 },
				message: {
					text: "plot",
					message_id: 10,
				},
				reply: async (_text: string) => undefined,
				replyWithChatAction: async (_action: string) => undefined,
				replyWithPhoto,
				replyWithStream: async (
					iterable: AsyncIterable<string>,
					_placeholder: unknown,
					_options: unknown,
				) => {
					for await (const _chunk of iterable) {
						// Drain
					}
				},
			},
			{
				rememberMessageImage,
				streamPrompt: (_prompt, _images, onImage) =>
					(async function* () {
						await onImage?.({
							type: "image",
							path: "/tmp/chart.png",
						});
						yield "done";
					})(),
			},
		);

		expect(rememberMessageImage).toHaveBeenCalledWith({
			chatId: 321,
			messageId: 88,
			image: { path: "/tmp/chart.png", mediaType: "image/png" },
			direction: "outbound",
		});
	});
});
