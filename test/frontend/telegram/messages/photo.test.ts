import { afterEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleTelegramPhotoMessage } from "../../../../src/frontend/telegram/messages/photo.ts";

function createPhotoContext(overrides: Record<string, unknown> = {}) {
	return {
		chat: { id: 123 },
		getFile: async () => ({ file_path: "photos/cat.jpg" }),
		message: {
			caption: "describe this",
			message_id: 10,
			photo: [{ file_id: "small" }, { file_id: "large" }],
		},
		reply: mock(async (_text: string) => undefined),
		replyWithChatAction: mock(async (_action: string) => undefined),
		replyWithPhoto: mock(async (_photo: unknown, _options: unknown) => ({
			message_id: 50,
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

describe("handleTelegramPhotoMessage", () => {
	const filesRoots: string[] = [];
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
		for (const filesRoot of filesRoots) {
			rmSync(filesRoot, { force: true, recursive: true });
		}
		filesRoots.length = 0;
	});

	test("saves the Telegram file, records it, and forwards it as an image prompt", async () => {
		const rememberMessageFile = mock(async () => {});
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
					yield { type: "text" as const, text: "done" };
				})(),
		);

		const ctx = createPhotoContext();

		await handleTelegramPhotoMessage(ctx, {
			rememberMessageFile,
			token: "TOKEN",
			saveMedia,
			streamPrompt,
		});

		expect(ctx.replyWithChatAction).toHaveBeenCalled();
		expect(streamPrompt).toHaveBeenCalledWith(
			"describe this",
			[{ path: "/tmp/cat.jpg", mediaType: "image/jpeg" }],
			expect.any(Function),
			undefined,
		);
		expect(rememberMessageFile).toHaveBeenCalledWith({
			chatId: 123,
			messageId: 10,
			file: {
				kind: "image",
				image: { path: "/tmp/cat.jpg", mediaType: "image/jpeg" },
			},
			direction: "inbound",
		});
		expect(ctx.sendMessage).toHaveBeenCalled();
	});

	test("reattaches the replied-to image before the new upload", async () => {
		const resolveMessageFile = mock(async () => ({
			kind: "image" as const,
			image: {
				path: "/tmp/previous.png",
				mediaType: "image/png" as const,
			},
		}));
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

		const ctx = createPhotoContext({
			message: {
				caption: "compare them",
				message_id: 10,
				reply_to_message: { message_id: 9 },
				photo: [{ file_id: "small" }, { file_id: "large" }],
			},
			getFile: async () => ({ file_path: "photos/cat.jpg" }),
		});

		await handleTelegramPhotoMessage(ctx, {
			resolveMessageFile,
			rememberMessageFile: async () => undefined,
			token: "TOKEN",
			saveMedia: async () => ({
				path: "/tmp/current.jpg",
				mediaType: "image/jpeg",
			}),
			streamPrompt,
		});

		expect(resolveMessageFile).toHaveBeenCalledWith(123, 9);
		expect(streamPrompt).toHaveBeenCalledWith(
			"compare them",
			[
				{ path: "/tmp/previous.png", mediaType: "image/png" },
				{ path: "/tmp/current.jpg", mediaType: "image/jpeg" },
			],
			expect.any(Function),
			undefined,
		);
	});

	test("reattaches the replied-to document reference before the new upload", async () => {
		const resolveMessageFile = mock(async () => ({
			kind: "document" as const,
			document: {
				path: "/tmp/report.pdf",
				displayName: "report.pdf",
			},
		}));
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

		const ctx = createPhotoContext({
			message: {
				caption: "compare with this image",
				message_id: 10,
				reply_to_message: { message_id: 9 },
				photo: [{ file_id: "small" }, { file_id: "large" }],
			},
			getFile: async () => ({ file_path: "photos/cat.jpg" }),
		});

		await handleTelegramPhotoMessage(ctx, {
			resolveMessageFile,
			rememberMessageFile: async () => undefined,
			token: "TOKEN",
			saveMedia: async () => ({
				path: "/tmp/current.jpg",
				mediaType: "image/jpeg",
			}),
			streamPrompt,
		});

		expect(streamPrompt).toHaveBeenCalledWith(
			"compare with this image\n\n[file: report.pdf -> /tmp/report.pdf]",
			[{ path: "/tmp/current.jpg", mediaType: "image/jpeg" }],
			expect.any(Function),
			undefined,
		);
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

		const ctx = createPhotoContext({
			message: {
				caption: "what is this?",
				message_id: 10,
				reply_to_message: { message_id: 9, text: "previous message" },
				photo: [{ file_id: "large" }],
			},
			getFile: async () => ({ file_path: "photos/cat.jpg" }),
		});

		await handleTelegramPhotoMessage(ctx, {
			rememberMessageFile: async () => undefined,
			token: "TOKEN",
			saveMedia: async () => ({
				path: "/tmp/current.jpg",
				mediaType: "image/jpeg" as const,
			}),
			streamPrompt,
		});

		expect(streamPrompt).toHaveBeenCalledWith(
			"what is this?",
			[{ path: "/tmp/current.jpg", mediaType: "image/jpeg" }],
			expect.any(Function),
			{ text: "previous message" },
		);
	});

	test("reports an error when Telegram does not return a file path", async () => {
		const ctx = createPhotoContext({
			getFile: async () => ({ file_path: undefined }),
			message: {
				caption: undefined,
				message_id: 10,
				photo: [{ file_id: "photo" }],
			},
		});

		await handleTelegramPhotoMessage(ctx, {
			rememberMessageFile: async () => undefined,
			token: "TOKEN",
			saveMedia: async () => {
				throw new Error("should not be called");
			},
			streamPrompt: () =>
				(async function* () {
					yield { type: "text" as const, text: "" };
				})(),
		});

		expect(ctx.reply).toHaveBeenCalledWith(
			"[error] Telegram file path is missing",
		);
	});

	test("uses the default media saver and stores outbound image refs", async () => {
		const filesRoot = mkdtempSync(join(tmpdir(), "mis-photo-message-"));
		filesRoots.push(filesRoot);
		globalThis.fetch = mock(async (url: string | URL | Request) => {
			expect(String(url)).toBe(
				"https://api.telegram.org/file/botTOKEN/photos/cat.png",
			);
			return new Response(Uint8Array.from([1, 2, 3, 4]), { status: 200 });
		}) as unknown as typeof fetch;

		const rememberMessageFile = mock(async () => {});
		const ctx = createPhotoContext({
			getFile: async () => ({ file_path: "photos/cat.png" }),
			message: {
				caption: "describe this",
				message_id: 10,
				photo: [{ file_id: "small" }],
			},
			replyWithPhoto: mock(async (_photo: unknown, _options: unknown) => ({
				message_id: 77,
			})),
		});

		let receivedImages: Array<{ path: string; mediaType: string }> | undefined;

		await handleTelegramPhotoMessage(ctx, {
			rememberMessageFile,
			token: "TOKEN",
			filesRoot,
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
					yield { type: "text" as const, text: "done" };
				})(),
		});

		expect(receivedImages?.length).toBe(1);
		const savedImage = receivedImages?.[0];
		expect(savedImage?.mediaType).toBe("image/png");
		expect(savedImage?.path.startsWith(filesRoot)).toBeTrue();
		expect(savedImage?.path.endsWith(".png")).toBeTrue();
		expect(existsSync(savedImage?.path ?? "")).toBeTrue();
		expect(readFileSync(savedImage?.path ?? "")).toEqual(
			Buffer.from([1, 2, 3, 4]),
		);
		expect(rememberMessageFile).toHaveBeenCalledWith({
			chatId: 123,
			messageId: 10,
			file: {
				kind: "image",
				image: savedImage,
			},
			direction: "inbound",
		});
		expect(rememberMessageFile).toHaveBeenCalledWith({
			chatId: 123,
			messageId: 77,
			file: {
				kind: "image",
				image: {
					path: "/tmp/outbound.png",
					mediaType: "image/png",
				},
			},
			direction: "outbound",
		});
	});

	test("reports an error when the default media saver has no filesRoot", async () => {
		const ctx = createPhotoContext({
			getFile: async () => ({ file_path: "photos/cat.jpg" }),
			message: {
				caption: "describe this",
				message_id: 10,
				photo: [{ file_id: "photo" }],
			},
		});

		await handleTelegramPhotoMessage(ctx, {
			token: "TOKEN",
			streamPrompt: () =>
				(async function* () {
					yield { type: "text" as const, text: "" };
				})(),
		});

		expect(ctx.reply).toHaveBeenCalledWith(
			"[error] Telegram files root is not configured",
		);
	});

	test("reports an error when the message has no photo sizes", async () => {
		const ctx = createPhotoContext({
			message: {
				caption: "describe this",
				message_id: 10,
				photo: [],
			},
		});

		await handleTelegramPhotoMessage(ctx, {
			token: "TOKEN",
			saveMedia: async () => {
				throw new Error("should not be called");
			},
			streamPrompt: () =>
				(async function* () {
					yield { type: "text" as const, text: "" };
				})(),
		});

		expect(ctx.reply).toHaveBeenCalledWith(
			"[error] Telegram photo message is missing photo sizes",
		);
	});
});
