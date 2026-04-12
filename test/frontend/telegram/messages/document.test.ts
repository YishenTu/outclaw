import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleTelegramDocumentMessage } from "../../../../src/frontend/telegram/messages/document.ts";

function createDocContext(overrides: Record<string, unknown> = {}) {
	return {
		chat: { id: 123 },
		getFile: async () => ({ file_path: "documents/report.pdf" }),
		message: {
			caption: "analyse this",
			message_id: 10,
			document: { file_id: "doc-1", file_name: "report.pdf" },
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

describe("handleTelegramDocumentMessage", () => {
	const filesRoots: string[] = [];
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
		for (const root of filesRoots) {
			rmSync(root, { force: true, recursive: true });
		}
		filesRoots.length = 0;
	});

	test("saves file and sends prompt with file reference", async () => {
		const filesRoot = mkdtempSync(join(tmpdir(), "tg-doc-"));
		filesRoots.push(filesRoot);
		globalThis.fetch = mock(async () => {
			return new Response(Buffer.from("pdf-bytes"), { status: 200 });
		}) as unknown as typeof fetch;

		let receivedPrompt = "";
		const streamPrompt = mock((prompt: string) => {
			receivedPrompt = prompt;
			return (async function* () {
				yield { type: "text" as const, text: "done" };
			})();
		});

		const ctx = createDocContext();

		await handleTelegramDocumentMessage(ctx, {
			token: "TOKEN",
			filesRoot,
			streamPrompt,
		});

		expect(receivedPrompt).toContain("analyse this");
		expect(receivedPrompt).toContain("[file: report.pdf");
		expect(receivedPrompt).toContain(filesRoot);
		expect(ctx.replyWithChatAction).toHaveBeenCalled();
		expect(ctx.sendMessage).toHaveBeenCalled();
	});

	test("stores the inbound document reference for follow-up replies", async () => {
		const filesRoot = mkdtempSync(join(tmpdir(), "tg-doc-"));
		filesRoots.push(filesRoot);
		globalThis.fetch = mock(async () => {
			return new Response(Buffer.from("pdf-bytes"), { status: 200 });
		}) as unknown as typeof fetch;

		const rememberMessageFile = mock(async () => undefined);
		const ctx = createDocContext();

		await handleTelegramDocumentMessage(ctx, {
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
					document: { path: string; displayName: string };
				};
			},
		];
		expect(record).toMatchObject({
			chatId: 123,
			messageId: 10,
			file: {
				kind: "document",
				document: { displayName: "report.pdf" },
			},
			direction: "inbound",
		});
		expect(record.file.document.path.startsWith(filesRoot)).toBeTrue();
	});

	test("uses file_name from document metadata", async () => {
		const filesRoot = mkdtempSync(join(tmpdir(), "tg-doc-"));
		filesRoots.push(filesRoot);
		globalThis.fetch = mock(async () => {
			return new Response(Buffer.from("csv-bytes"), { status: 200 });
		}) as unknown as typeof fetch;

		let receivedPrompt = "";
		const streamPrompt = mock((prompt: string) => {
			receivedPrompt = prompt;
			return (async function* () {
				yield { type: "text" as const, text: "done" };
			})();
		});

		const ctx = createDocContext({
			getFile: async () => ({ file_path: "documents/data.csv" }),
			message: {
				caption: "parse this",
				message_id: 11,
				document: { file_id: "doc-2", file_name: "quarterly-data.csv" },
			},
		});

		await handleTelegramDocumentMessage(ctx, {
			token: "TOKEN",
			filesRoot,
			streamPrompt,
		});

		expect(receivedPrompt).toContain("quarterly-data.csv");
	});

	test("sends just the file reference when no caption", async () => {
		const filesRoot = mkdtempSync(join(tmpdir(), "tg-doc-"));
		filesRoots.push(filesRoot);
		globalThis.fetch = mock(async () => {
			return new Response(Buffer.from("bytes"), { status: 200 });
		}) as unknown as typeof fetch;

		let receivedPrompt = "";
		const streamPrompt = mock((prompt: string) => {
			receivedPrompt = prompt;
			return (async function* () {
				yield { type: "text" as const, text: "done" };
			})();
		});

		const ctx = createDocContext({
			message: {
				caption: undefined,
				message_id: 12,
				document: { file_id: "doc-3", file_name: "notes.txt" },
			},
		});

		await handleTelegramDocumentMessage(ctx, {
			token: "TOKEN",
			filesRoot,
			streamPrompt,
		});

		expect(receivedPrompt).toStartWith("[file:");
		expect(receivedPrompt).toContain("notes.txt");
	});

	test("includes reply context", async () => {
		const filesRoot = mkdtempSync(join(tmpdir(), "tg-doc-"));
		filesRoots.push(filesRoot);
		globalThis.fetch = mock(async () => {
			return new Response(Buffer.from("bytes"), { status: 200 });
		}) as unknown as typeof fetch;

		let receivedReplyContext: { text: string } | undefined;
		const streamPrompt = mock(
			(
				_prompt: string,
				_images?: unknown[],
				_onImage?: unknown,
				replyContext?: { text: string },
			) => {
				receivedReplyContext = replyContext;
				return (async function* () {
					yield { type: "text" as const, text: "done" };
				})();
			},
		);

		const ctx = createDocContext({
			message: {
				caption: "what about this?",
				message_id: 13,
				document: { file_id: "doc-4", file_name: "data.json" },
				reply_to_message: { message_id: 9, text: "previous context" },
			},
		});

		await handleTelegramDocumentMessage(ctx, {
			token: "TOKEN",
			filesRoot,
			streamPrompt,
		});

		expect(receivedReplyContext).toEqual({ text: "previous context" });
	});

	test("reports error when file path is missing", async () => {
		const ctx = createDocContext({
			getFile: async () => ({ file_path: undefined }),
		});

		await handleTelegramDocumentMessage(ctx, {
			token: "TOKEN",
			filesRoot: "/tmp",
			streamPrompt: () =>
				(async function* () {
					yield { type: "text" as const, text: "" };
				})(),
		});

		expect(ctx.reply).toHaveBeenCalledWith(
			"[error] Telegram file path is missing",
		);
	});

	test("reports error when filesRoot is missing", async () => {
		const ctx = createDocContext();

		await handleTelegramDocumentMessage(ctx, {
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

	test("falls back to extension from file_path when file_name is missing", async () => {
		const filesRoot = mkdtempSync(join(tmpdir(), "tg-doc-"));
		filesRoots.push(filesRoot);
		globalThis.fetch = mock(async () => {
			return new Response(Buffer.from("bytes"), { status: 200 });
		}) as unknown as typeof fetch;

		let receivedPrompt = "";
		const streamPrompt = mock((prompt: string) => {
			receivedPrompt = prompt;
			return (async function* () {
				yield { type: "text" as const, text: "done" };
			})();
		});

		const ctx = createDocContext({
			getFile: async () => ({ file_path: "documents/file_42.pdf" }),
			message: {
				caption: "check this",
				message_id: 14,
				document: { file_id: "doc-5" },
			},
		});

		await handleTelegramDocumentMessage(ctx, {
			token: "TOKEN",
			filesRoot,
			streamPrompt,
		});

		expect(receivedPrompt).toContain("file_42.pdf");
	});
});
