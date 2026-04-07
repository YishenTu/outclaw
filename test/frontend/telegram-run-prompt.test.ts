import { describe, expect, mock, test } from "bun:test";
import { InputFile } from "grammy";
import { runTelegramPrompt } from "../../src/frontend/telegram/run-prompt.ts";

describe("runTelegramPrompt", () => {
	test("streams text replies and sends outbound images", async () => {
		const replyWithChatAction = mock(async (_action: string) => {});
		const replyWithPhoto = mock(async (_photo: unknown, _options: unknown) => ({
			message_id: 1,
		}));
		const replyWithStream = mock(
			async (
				iterable: AsyncIterable<string>,
				_placeholder: undefined,
				_options: { disable_notification: boolean },
			) => {
				for await (const _chunk of iterable) {
					// Drain
				}
			},
		);

		await runTelegramPrompt(
			{
				replyWithChatAction,
				replyWithPhoto,
				replyWithStream,
			},
			{
				prompt: "plot",
				streamPrompt: (_prompt, _images, onImage) =>
					(async function* () {
						yield "Here is ";
						await onImage?.({
							type: "image",
							path: "/tmp/chart.png",
						});
						yield "your chart.";
					})(),
			},
		);

		expect(replyWithChatAction).toHaveBeenCalled();
		expect(replyWithStream).toHaveBeenCalledTimes(1);
		expect(replyWithPhoto).toHaveBeenCalledTimes(1);
		expect(replyWithPhoto.mock.calls[0]?.[0]).toBeInstanceOf(InputFile);
		expect(
			(
				replyWithPhoto.mock.calls[0]?.[0] as unknown as {
					fileData: string;
				}
			).fileData,
		).toBe("/tmp/chart.png");
		expect(replyWithPhoto.mock.calls[0]?.[1]).toEqual({
			disable_notification: true,
		});
	});

	test("sends outbound images without opening a text stream for image-only replies", async () => {
		const replyWithChatAction = mock(async (_action: string) => {});
		const replyWithPhoto = mock(async (_photo: unknown, _options: unknown) => ({
			message_id: 2,
		}));
		const replyWithStream = mock(
			async (
				_iterable: AsyncIterable<string>,
				_placeholder: undefined,
				_options: { disable_notification: boolean },
			) => undefined,
		);

		await runTelegramPrompt(
			{
				replyWithChatAction,
				replyWithPhoto,
				replyWithStream,
			},
			{
				prompt: "plot",
				streamPrompt: (_prompt, _images, onImage) =>
					(async function* () {
						await onImage?.({
							type: "image",
							path: "/tmp/chart.png",
						});
						yield* [];
					})(),
			},
		);

		expect(replyWithPhoto).toHaveBeenCalledTimes(1);
		expect(replyWithStream).not.toHaveBeenCalled();
	});
});
