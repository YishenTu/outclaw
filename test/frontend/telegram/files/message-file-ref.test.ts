import { describe, expect, test } from "bun:test";
import type { ImageRef } from "../../../../src/common/protocol.ts";
import {
	appendPromptSegments,
	formatTelegramDocumentPromptRef,
	formatTelegramVoicePromptRef,
	rememberOutboundImage,
	resolveReplyAttachments,
	type TelegramMessageFileRecord,
} from "../../../../src/frontend/telegram/files/message-file-ref.ts";

describe("resolveReplyAttachments", () => {
	test("returns empty attachments when no reply message", async () => {
		const result = await resolveReplyAttachments(123, undefined);
		expect(result).toEqual({ images: [], promptSegments: [] });
	});

	test("returns empty attachments when no resolver provided", async () => {
		const result = await resolveReplyAttachments(123, { message_id: 1 });
		expect(result).toEqual({ images: [], promptSegments: [] });
	});

	test("returns resolved image when found", async () => {
		const image: ImageRef = { path: "/tmp/cat.png", mediaType: "image/png" };
		const resolver = async (_chatId: number, _msgId: number) => ({
			kind: "image" as const,
			image,
		});

		const result = await resolveReplyAttachments(
			123,
			{ message_id: 42 },
			resolver,
		);
		expect(result).toEqual({ images: [image], promptSegments: [] });
	});

	test("returns a prompt segment for a replied-to document", async () => {
		const resolver = async (_chatId: number, _msgId: number) => ({
			kind: "document" as const,
			document: {
				path: "/tmp/report.pdf",
				displayName: "report.pdf",
			},
		});

		const result = await resolveReplyAttachments(
			123,
			{ message_id: 42 },
			resolver,
		);
		expect(result).toEqual({
			images: [],
			promptSegments: ["[file: report.pdf -> /tmp/report.pdf]"],
		});
	});

	test("returns a prompt segment for a replied-to voice note", async () => {
		const resolver = async (_chatId: number, _msgId: number) => ({
			kind: "voice" as const,
			voice: {
				path: "/tmp/note.oga",
				durationSeconds: 12,
				mimeType: "audio/ogg",
			},
		});

		const result = await resolveReplyAttachments(
			123,
			{ message_id: 42 },
			resolver,
		);
		expect(result).toEqual({
			images: [],
			promptSegments: ["[voice note (oga, 12s): /tmp/note.oga]"],
		});
	});

	test("returns empty when resolver returns undefined", async () => {
		const resolver = async () => undefined;
		const result = await resolveReplyAttachments(
			123,
			{ message_id: 42 },
			resolver,
		);
		expect(result).toEqual({ images: [], promptSegments: [] });
	});

	test("passes correct chatId and messageId to resolver", async () => {
		let receivedChat = 0;
		let receivedMsg = 0;
		const resolver = async (chatId: number, msgId: number) => {
			receivedChat = chatId;
			receivedMsg = msgId;
			return undefined;
		};

		await resolveReplyAttachments(999, { message_id: 55 }, resolver);
		expect(receivedChat).toBe(999);
		expect(receivedMsg).toBe(55);
	});
});

describe("formatTelegramDocumentPromptRef", () => {
	test("formats a document reference for prompt delivery", () => {
		expect(
			formatTelegramDocumentPromptRef({
				path: "/tmp/report.pdf",
				displayName: "report.pdf",
			}),
		).toBe("[file: report.pdf -> /tmp/report.pdf]");
	});
});

describe("formatTelegramVoicePromptRef", () => {
	test("formats a Telegram voice note reference for prompt delivery", () => {
		expect(
			formatTelegramVoicePromptRef({
				path: "/tmp/note.oga",
				durationSeconds: 12,
				mimeType: "audio/ogg",
			}),
		).toBe("[voice note (oga, 12s): /tmp/note.oga]");
	});

	test("formats a generic audio file reference when not an oga voice note", () => {
		expect(
			formatTelegramVoicePromptRef({
				path: "/tmp/song.mp3",
				durationSeconds: 95,
				mimeType: "audio/mpeg",
			}),
		).toBe("[voice audio (mp3, 95s): /tmp/song.mp3]");
	});
});

describe("appendPromptSegments", () => {
	test("appends prompt segments after the main prompt", () => {
		expect(
			appendPromptSegments("use page 3", [
				"[file: report.pdf -> /tmp/report.pdf]",
			]),
		).toBe("use page 3\n\n[file: report.pdf -> /tmp/report.pdf]");
	});

	test("returns only prompt segments when the prompt is empty", () => {
		expect(
			appendPromptSegments("", ["[file: report.pdf -> /tmp/report.pdf]"]),
		).toBe("[file: report.pdf -> /tmp/report.pdf]");
	});
});

describe("rememberOutboundImage", () => {
	test("does nothing when no callback provided", async () => {
		await rememberOutboundImage(123, 1, { type: "image", path: "/tmp/a.png" });
	});

	test("calls callback with a file-aware image record", async () => {
		const records: TelegramMessageFileRecord[] = [];
		const remember = async (record: TelegramMessageFileRecord) => {
			records.push(record);
		};

		await rememberOutboundImage(
			100,
			42,
			{ type: "image", path: "/tmp/chart.png" },
			remember,
		);

		expect(records).toHaveLength(1);
		expect(records[0]).toEqual({
			chatId: 100,
			messageId: 42,
			file: {
				kind: "image",
				image: { path: "/tmp/chart.png", mediaType: "image/png" },
			},
			direction: "outbound",
		});
	});
});
