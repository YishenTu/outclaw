import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleTelegramVoiceMessage } from "../../../../src/frontend/telegram/messages/voice.ts";

function createVoiceContext(overrides: Record<string, unknown> = {}) {
	return {
		chat: { id: 123 },
		getFile: async () => ({ file_path: "voice/file_1.oga" }),
		message: {
			message_id: 10,
			voice: {
				file_id: "voice-1",
				file_size: 1024,
				mime_type: "audio/ogg",
				duration: 12,
			},
			reply_to_message: undefined as
				| { message_id: number; text?: string; caption?: string }
				| undefined,
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

describe("handleTelegramVoiceMessage", () => {
	const filesRoots: string[] = [];
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
		for (const root of filesRoots) {
			rmSync(root, { force: true, recursive: true });
		}
		filesRoots.length = 0;
	});

	test("saves a Telegram voice note and sends a voice prompt segment", async () => {
		const filesRoot = mkdtempSync(join(tmpdir(), "tg-voice-"));
		filesRoots.push(filesRoot);
		globalThis.fetch = mock(async () => {
			return new Response(Buffer.from("voice-bytes"), { status: 200 });
		}) as unknown as typeof fetch;

		let receivedPrompt = "";
		const streamPrompt = mock((prompt: string) => {
			receivedPrompt = prompt;
			return (async function* () {
				yield { type: "text" as const, text: "done" };
			})();
		});

		const ctx = createVoiceContext();

		await handleTelegramVoiceMessage(ctx, {
			token: "TOKEN",
			filesRoot,
			streamPrompt,
		});

		expect(receivedPrompt).toStartWith("[voice note (oga, 12s): ");
		expect(receivedPrompt).toEndWith("]");
		expect(receivedPrompt).toContain(filesRoot);
		expect(ctx.replyWithChatAction).toHaveBeenCalled();
		expect(ctx.sendMessage).toHaveBeenCalled();
	});

	test("stores the inbound voice reference for follow-up replies", async () => {
		const filesRoot = mkdtempSync(join(tmpdir(), "tg-voice-"));
		filesRoots.push(filesRoot);
		globalThis.fetch = mock(async () => {
			return new Response(Buffer.from("voice-bytes"), { status: 200 });
		}) as unknown as typeof fetch;

		const rememberMessageFile = mock(async () => undefined);
		const ctx = createVoiceContext();

		await handleTelegramVoiceMessage(ctx, {
			token: "TOKEN",
			filesRoot,
			rememberMessageFile,
			streamPrompt: () =>
				(async function* () {
					yield { type: "text" as const, text: "done" };
				})(),
		});

		expect(rememberMessageFile).toHaveBeenCalledTimes(1);
		const [record] = rememberMessageFile.mock.calls[0] as unknown as [
			{
				file: {
					kind: string;
					voice: {
						path: string;
						mimeType?: string;
						durationSeconds?: number;
					};
				};
			},
		];
		expect(record).toMatchObject({
			chatId: 123,
			messageId: 10,
			file: {
				kind: "voice",
				voice: {
					mimeType: "audio/ogg",
					durationSeconds: 12,
				},
			},
			direction: "inbound",
		});
		expect(record.file.voice.path.startsWith(filesRoot)).toBeTrue();
	});

	test("appends a replied-to voice note before the new upload", async () => {
		const filesRoot = mkdtempSync(join(tmpdir(), "tg-voice-"));
		filesRoots.push(filesRoot);
		globalThis.fetch = mock(async () => {
			return new Response(Buffer.from("voice-bytes"), { status: 200 });
		}) as unknown as typeof fetch;

		let receivedPrompt = "";
		const streamPrompt = mock((prompt: string) => {
			receivedPrompt = prompt;
			return (async function* () {
				yield { type: "text" as const, text: "done" };
			})();
		});

		const ctx = createVoiceContext({
			message: {
				message_id: 10,
				voice: {
					file_id: "voice-1",
					file_size: 1024,
					mime_type: "audio/ogg",
					duration: 12,
				},
				reply_to_message: { message_id: 9 },
			},
		});

		await handleTelegramVoiceMessage(ctx, {
			token: "TOKEN",
			filesRoot,
			resolveMessageFile: async () => ({
				kind: "voice",
				voice: {
					path: "/tmp/previous.oga",
					durationSeconds: 5,
					mimeType: "audio/ogg",
				},
			}),
			streamPrompt,
		});

		expect(receivedPrompt).toContain(
			"[voice note (oga, 5s): /tmp/previous.oga]",
		);
		expect(receivedPrompt).toContain(filesRoot);
	});

	test("uses audio metadata for message:audio uploads", async () => {
		const filesRoot = mkdtempSync(join(tmpdir(), "tg-voice-"));
		filesRoots.push(filesRoot);
		globalThis.fetch = mock(async () => {
			return new Response(Buffer.from("audio-bytes"), { status: 200 });
		}) as unknown as typeof fetch;

		let receivedPrompt = "";
		const streamPrompt = mock((prompt: string) => {
			receivedPrompt = prompt;
			return (async function* () {
				yield { type: "text" as const, text: "done" };
			})();
		});

		const ctx = createVoiceContext({
			getFile: async () => ({ file_path: "audio/file_1.dat" }),
			message: {
				message_id: 11,
				audio: {
					file_id: "audio-1",
					file_name: "song.mp3",
					file_size: 4096,
					mime_type: "audio/mpeg",
					duration: 95,
					caption: "summarize this",
				},
			},
		});

		await handleTelegramVoiceMessage(ctx, {
			token: "TOKEN",
			filesRoot,
			streamPrompt,
		});

		expect(receivedPrompt).toContain("summarize this");
		expect(receivedPrompt).toContain("[voice audio (mp3, 95s):");
	});

	test("rejects files larger than the default limit", async () => {
		const ctx = createVoiceContext({
			message: {
				message_id: 10,
				voice: {
					file_id: "voice-1",
					file_size: 20 * 1024 * 1024 + 1,
					mime_type: "audio/ogg",
					duration: 12,
				},
			},
		});

		await handleTelegramVoiceMessage(ctx, {
			token: "TOKEN",
			filesRoot: "/tmp/files",
			streamPrompt: () =>
				(async function* () {
					yield { type: "text" as const, text: "" };
				})(),
		});

		expect(ctx.reply).toHaveBeenCalledWith(
			"[error] voice note too large (20 MB limit)",
		);
	});
});
