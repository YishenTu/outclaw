import { afterEach, describe, expect, mock, test } from "bun:test";
import { InputFile } from "grammy";
import { runTelegramPrompt } from "../../../../src/frontend/telegram/messages/prompt.ts";

describe("runTelegramPrompt", () => {
	const realSetInterval = globalThis.setInterval;
	const realClearInterval = globalThis.clearInterval;

	afterEach(() => {
		globalThis.setInterval = realSetInterval;
		globalThis.clearInterval = realClearInterval;
	});

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

	test("re-sends typing updates on the interval and swallows interval failures", async () => {
		const intervalCallbacks: Array<() => void> = [];
		const clearInterval = mock((_handle: unknown) => {});
		globalThis.setInterval = ((handler: () => void) => {
			intervalCallbacks.push(handler);
			return { timer: "typing" } as unknown as Timer;
		}) as typeof setInterval;
		globalThis.clearInterval = clearInterval as typeof clearInterval;

		let typingCalls = 0;
		const replyWithChatAction = mock(async (_action: string) => {
			typingCalls++;
			if (typingCalls === 2) {
				throw new Error("Telegram typing failed");
			}
		});

		await runTelegramPrompt(
			{
				replyWithChatAction,
				replyWithPhoto: async (_photo: unknown, _options: unknown) => ({
					message_id: 1,
				}),
				replyWithStream: async (
					iterable: AsyncIterable<string>,
					_placeholder: undefined,
					_options: { disable_notification: boolean },
				) => {
					for await (const _chunk of iterable) {
						// Drain
					}
				},
			},
			{
				prompt: "hello",
				streamPrompt: () =>
					(async function* () {
						intervalCallbacks[0]?.();
						await Promise.resolve();
						yield "done";
					})(),
			},
		);

		expect(replyWithChatAction).toHaveBeenCalledTimes(2);
		expect(clearInterval).toHaveBeenCalledTimes(1);
	});

	test("remembers sent images after uploading them", async () => {
		const rememberSentImage = mock(async () => {});

		await runTelegramPrompt(
			{
				replyWithChatAction: async (_action: string) => undefined,
				replyWithPhoto: async (_photo: unknown, _options: unknown) => ({
					message_id: 42,
				}),
				replyWithStream: async (
					_iterable: AsyncIterable<string>,
					_placeholder: undefined,
					_options: { disable_notification: boolean },
				) => undefined,
			},
			{
				prompt: "plot",
				rememberSentImage,
				streamPrompt: (_prompt, _images, onImage) =>
					(async function* () {
						await onImage?.({
							type: "image",
							path: "/tmp/chart.png",
							caption: "chart",
						});
						yield* [];
					})(),
			},
		);

		expect(rememberSentImage).toHaveBeenCalledWith(42, {
			type: "image",
			path: "/tmp/chart.png",
			caption: "chart",
		});
	});
});
