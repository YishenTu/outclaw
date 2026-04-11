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

	function createContext() {
		return {
			chatId: 42,
			replyWithChatAction: mock(async (_action: string) => {}),
			replyWithPhoto: mock(async (_photo: unknown, _options: unknown) => ({
				message_id: 1,
			})),
			sendMessage: mock(async (_text: string, _options: object) => ({
				message_id: 10,
			})),
			editMessageText: mock(
				async (_messageId: number, _text: string, _options: object) => {},
			),
		};
	}

	test("sends streamed text as HTML via sendMessage", async () => {
		const ctx = createContext();

		await runTelegramPrompt(ctx, {
			prompt: "hello",
			streamPrompt: () =>
				(async function* () {
					yield { type: "text" as const, text: "**bold** reply" };
				})(),
		});

		expect(ctx.replyWithChatAction).toHaveBeenCalled();
		expect(ctx.sendMessage).toHaveBeenCalledTimes(1);
		expect(ctx.sendMessage.mock.calls[0]?.[0]).toBe("<b>bold</b> reply");
		expect(ctx.sendMessage.mock.calls[0]?.[1]).toEqual({
			parse_mode: "HTML",
			disable_notification: true,
		});
	});

	test("sends outbound images", async () => {
		const ctx = createContext();

		await runTelegramPrompt(ctx, {
			prompt: "plot",
			streamPrompt: (_prompt, _images, onImage) =>
				(async function* () {
					yield { type: "text" as const, text: "Here is " };
					await onImage?.({
						type: "image",
						path: "/tmp/chart.png",
					});
					yield { type: "text" as const, text: "your chart." };
				})(),
		});

		expect(ctx.replyWithPhoto).toHaveBeenCalledTimes(1);
		expect(ctx.replyWithPhoto.mock.calls[0]?.[0]).toBeInstanceOf(InputFile);
		expect(
			(
				ctx.replyWithPhoto.mock.calls[0]?.[0] as unknown as {
					fileData: string;
				}
			).fileData,
		).toBe("/tmp/chart.png");
		expect(ctx.replyWithPhoto.mock.calls[0]?.[1]).toEqual({
			disable_notification: true,
		});
	});

	test("sends thinking chunks in a separate expandable blockquote", async () => {
		const ctx = createContext();

		await runTelegramPrompt(ctx, {
			prompt: "hello",
			streamPrompt: () =>
				(async function* () {
					yield { type: "thinking" as const, text: "**plan**" };
					yield { type: "text" as const, text: "answer" };
				})(),
		});

		expect(ctx.sendMessage).toHaveBeenCalledTimes(2);
		expect(ctx.sendMessage.mock.calls[0]?.[0]).toBe(
			"<blockquote expandable><b>plan</b></blockquote>",
		);
		expect(ctx.sendMessage.mock.calls[1]?.[0]).toBe("answer");
	});

	test("does not send a message for image-only replies", async () => {
		const ctx = createContext();

		await runTelegramPrompt(ctx, {
			prompt: "plot",
			streamPrompt: (_prompt, _images, onImage) =>
				(async function* () {
					await onImage?.({
						type: "image",
						path: "/tmp/chart.png",
					});
					yield* [];
				})(),
		});

		expect(ctx.replyWithPhoto).toHaveBeenCalledTimes(1);
		expect(ctx.sendMessage).not.toHaveBeenCalled();
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
		const ctx = {
			...createContext(),
			replyWithChatAction: mock(async (_action: string) => {
				typingCalls++;
				if (typingCalls === 2) {
					throw new Error("Telegram typing failed");
				}
			}),
		};

		await runTelegramPrompt(ctx, {
			prompt: "hello",
			streamPrompt: () =>
				(async function* () {
					intervalCallbacks[0]?.();
					await Promise.resolve();
					yield { type: "text" as const, text: "done" };
				})(),
		});

		expect(ctx.replyWithChatAction).toHaveBeenCalledTimes(2);
		expect(clearInterval).toHaveBeenCalledTimes(1);
	});

	test("remembers sent images after uploading them", async () => {
		const rememberSentImage = mock(async () => {});
		const ctx = {
			...createContext(),
			replyWithPhoto: mock(async (_photo: unknown, _options: unknown) => ({
				message_id: 42,
			})),
		};

		await runTelegramPrompt(ctx, {
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
		});

		expect(rememberSentImage).toHaveBeenCalledWith(42, {
			type: "image",
			path: "/tmp/chart.png",
			caption: "chart",
		});
	});

	test("edits message on subsequent chunks after throttle", async () => {
		const ctx = createContext();

		await runTelegramPrompt(ctx, {
			prompt: "hello",
			streamPrompt: () =>
				(async function* () {
					yield { type: "text" as const, text: "first " };
					// Even if chunks arrive fast, final edit happens
					yield { type: "text" as const, text: "second" };
				})(),
		});

		// Final accumulated text is sent/edited
		const lastSendText = ctx.sendMessage.mock.calls.at(-1)?.[0];
		const lastEditText = ctx.editMessageText.mock.calls.at(-1)?.[1];
		const finalText = lastEditText ?? lastSendText;
		expect(finalText).toBe("first second");
	});

	test("skips redundant final edit when content unchanged", async () => {
		const ctx = createContext();

		await runTelegramPrompt(ctx, {
			prompt: "hello",
			streamPrompt: () =>
				(async function* () {
					yield { type: "text" as const, text: "one chunk" };
				})(),
		});

		// Single chunk: sendMessage once, no editMessageText needed
		expect(ctx.sendMessage).toHaveBeenCalledTimes(1);
		expect(ctx.editMessageText).not.toHaveBeenCalled();
	});

	test("swallows editMessageText errors and retries on final flush", async () => {
		const editCalls: string[] = [];
		const ctx = {
			...createContext(),
			sendMessage: mock(async (_text: string, _options: object) => ({
				message_id: 10,
			})),
			editMessageText: mock(
				async (_messageId: number, text: string, _options: object) => {
					editCalls.push(text);
					if (editCalls.length === 1) {
						throw new Error("Telegram edit failed");
					}
				},
			),
		};

		await runTelegramPrompt(ctx, {
			prompt: "hello",
			streamPrompt: () =>
				(async function* () {
					yield { type: "text" as const, text: "first" };
					await new Promise((r) => setTimeout(r, 1100));
					yield { type: "text" as const, text: " second" };
				})(),
		});

		expect(ctx.sendMessage).toHaveBeenCalledTimes(1);
		// First edit failed, but final flush retried because lastSentHtml
		// was NOT advanced on failure.
		expect(editCalls.length).toBeGreaterThanOrEqual(2);
		expect(editCalls.at(-1)).toBe("first second");
	});
});
