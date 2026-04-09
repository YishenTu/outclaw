import { afterEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleTelegramPhotoMessage } from "../../src/frontend/telegram/photo-message.ts";

describe("handleTelegramPhotoMessage", () => {
	const mediaRoots: string[] = [];
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
		for (const mediaRoot of mediaRoots) {
			rmSync(mediaRoot, { force: true, recursive: true });
		}
		mediaRoots.length = 0;
	});

	test("saves the Telegram file, records it, and forwards it as an image prompt", async () => {
		const replyWithChatAction = mock(async (_action: string) => {});
		const replyWithPhoto = mock(async (_photo: unknown, _options: unknown) => ({
			message_id: 50,
		}));
		const rememberMessageImage = mock(async () => {});
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
		const saveMedia = mock(
			async (url: string, ext: string, mediaType: string) => {
				expect(url).toBe(
					"https://api.telegram.org/file/botTOKEN/photos/cat.jpg",
				);
				expect(ext).toBe(".jpg");
				expect(mediaType).toBe("image/jpeg");
				return { path: "/tmp/cat.jpg", mediaType: "image/jpeg" as const };
			},
		);
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

		await handleTelegramPhotoMessage(
			{
				chat: { id: 123 },
				getFile: async () => ({ file_path: "photos/cat.jpg" }),
				message: {
					caption: "describe this",
					message_id: 10,
					photo: [{ file_id: "small" }, { file_id: "large" }],
				},
				reply: async (_text: string) => undefined,
				replyWithChatAction,
				replyWithPhoto,
				replyWithStream,
			},
			{
				rememberMessageImage,
				token: "TOKEN",
				saveMedia,
				streamPrompt,
			},
		);

		expect(replyWithChatAction).toHaveBeenCalled();
		expect(streamPrompt).toHaveBeenCalledWith(
			"describe this",
			[{ path: "/tmp/cat.jpg", mediaType: "image/jpeg" }],
			expect.any(Function),
		);
		expect(rememberMessageImage).toHaveBeenCalledWith({
			chatId: 123,
			messageId: 10,
			image: { path: "/tmp/cat.jpg", mediaType: "image/jpeg" },
			direction: "inbound",
		});
		expect(replyWithStream).toHaveBeenCalled();
	});

	test("reattaches the replied-to image before the new upload", async () => {
		const resolveMessageImage = mock(async () => ({
			path: "/tmp/previous.png",
			mediaType: "image/png" as const,
		}));
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

		await handleTelegramPhotoMessage(
			{
				chat: { id: 123 },
				getFile: async () => ({ file_path: "photos/cat.jpg" }),
				message: {
					caption: "compare them",
					message_id: 10,
					reply_to_message: { message_id: 9 },
					photo: [{ file_id: "small" }, { file_id: "large" }],
				},
				reply: async (_text: string) => undefined,
				replyWithChatAction: async (_action: string) => undefined,
				replyWithPhoto: async (_photo: unknown, _options: unknown) => ({
					message_id: 50,
				}),
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
				resolveMessageImage,
				rememberMessageImage: async () => undefined,
				token: "TOKEN",
				saveMedia: async () => ({
					path: "/tmp/current.jpg",
					mediaType: "image/jpeg",
				}),
				streamPrompt,
			},
		);

		expect(resolveMessageImage).toHaveBeenCalledWith(123, 9);
		expect(streamPrompt).toHaveBeenCalledWith(
			"compare them",
			[
				{ path: "/tmp/previous.png", mediaType: "image/png" },
				{ path: "/tmp/current.jpg", mediaType: "image/jpeg" },
			],
			expect.any(Function),
		);
	});

	test("reports an error when Telegram does not return a file path", async () => {
		const reply = mock(async (_text: string) => {});

		await handleTelegramPhotoMessage(
			{
				chat: { id: 123 },
				getFile: async () => ({ file_path: undefined }),
				message: {
					caption: undefined,
					message_id: 10,
					photo: [{ file_id: "photo" }],
				},
				reply,
				replyWithChatAction: async (_action: string) => undefined,
				replyWithPhoto: async (_photo: unknown, _options: unknown) => ({
					message_id: 1,
				}),
				replyWithStream: async (
					_iterable: AsyncIterable<string>,
					_placeholder: unknown,
					_options: unknown,
				) => undefined,
			},
			{
				rememberMessageImage: async () => undefined,
				token: "TOKEN",
				saveMedia: async () => {
					throw new Error("should not be called");
				},
				streamPrompt: () =>
					(async function* () {
						yield "";
					})(),
			},
		);

		expect(reply).toHaveBeenCalledWith("[error] Telegram file path is missing");
	});

	test("uses the default media saver and stores outbound image refs", async () => {
		const mediaRoot = mkdtempSync(join(tmpdir(), "mis-photo-message-"));
		mediaRoots.push(mediaRoot);
		globalThis.fetch = mock(async (url: string | URL | Request) => {
			expect(String(url)).toBe(
				"https://api.telegram.org/file/botTOKEN/photos/cat.png",
			);
			return new Response(Uint8Array.from([1, 2, 3, 4]), { status: 200 });
		}) as unknown as typeof fetch;

		const rememberMessageImage = mock(async () => {});
		const replyWithPhoto = mock(async (_photo: unknown, _options: unknown) => ({
			message_id: 77,
		}));
		let receivedImages: Array<{ path: string; mediaType: string }> | undefined;

		await handleTelegramPhotoMessage(
			{
				chat: { id: 123 },
				getFile: async () => ({ file_path: "photos/cat.png" }),
				message: {
					caption: "describe this",
					message_id: 10,
					photo: [{ file_id: "small" }],
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
				token: "TOKEN",
				mediaRoot,
				streamPrompt: (_prompt, images, onImage) =>
					(async function* () {
						receivedImages = images as Array<{
							path: string;
							mediaType: string;
						}>;
						await onImage?.({
							type: "image",
							path: "/tmp/outbound.png",
							caption: "result",
						});
						yield "done";
					})(),
			},
		);

		expect(receivedImages?.length).toBe(1);
		const savedImage = receivedImages?.[0];
		expect(savedImage?.mediaType).toBe("image/png");
		expect(savedImage?.path.startsWith(mediaRoot)).toBeTrue();
		expect(savedImage?.path.endsWith(".png")).toBeTrue();
		expect(existsSync(savedImage?.path ?? "")).toBeTrue();
		expect(readFileSync(savedImage?.path ?? "")).toEqual(
			Buffer.from([1, 2, 3, 4]),
		);
		expect(rememberMessageImage).toHaveBeenCalledWith({
			chatId: 123,
			messageId: 10,
			image: savedImage,
			direction: "inbound",
		});
		expect(rememberMessageImage).toHaveBeenCalledWith({
			chatId: 123,
			messageId: 77,
			image: {
				path: "/tmp/outbound.png",
				mediaType: "image/png",
			},
			direction: "outbound",
		});
	});

	test("reports an error when the default media saver has no mediaRoot", async () => {
		const reply = mock(async (_text: string) => {});

		await handleTelegramPhotoMessage(
			{
				chat: { id: 123 },
				getFile: async () => ({ file_path: "photos/cat.jpg" }),
				message: {
					caption: "describe this",
					message_id: 10,
					photo: [{ file_id: "photo" }],
				},
				reply,
				replyWithChatAction: async (_action: string) => undefined,
				replyWithPhoto: async (_photo: unknown, _options: unknown) => ({
					message_id: 1,
				}),
				replyWithStream: async (
					_iterable: AsyncIterable<string>,
					_placeholder: unknown,
					_options: unknown,
				) => undefined,
			},
			{
				token: "TOKEN",
				streamPrompt: () =>
					(async function* () {
						yield "";
					})(),
			},
		);

		expect(reply).toHaveBeenCalledWith(
			"[error] Telegram media root is not configured",
		);
	});

	test("reports an error when the message has no photo sizes", async () => {
		const reply = mock(async (_text: string) => {});

		await handleTelegramPhotoMessage(
			{
				chat: { id: 123 },
				getFile: async () => ({ file_path: "photos/cat.jpg" }),
				message: {
					caption: "describe this",
					message_id: 10,
					photo: [],
				},
				reply,
				replyWithChatAction: async (_action: string) => undefined,
				replyWithPhoto: async (_photo: unknown, _options: unknown) => ({
					message_id: 1,
				}),
				replyWithStream: async (
					_iterable: AsyncIterable<string>,
					_placeholder: unknown,
					_options: unknown,
				) => undefined,
			},
			{
				token: "TOKEN",
				saveMedia: async () => {
					throw new Error("should not be called");
				},
				streamPrompt: () =>
					(async function* () {
						yield "";
					})(),
			},
		);

		expect(reply).toHaveBeenCalledWith(
			"[error] Telegram photo message is missing photo sizes",
		);
	});
});
