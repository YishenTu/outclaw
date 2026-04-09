import { describe, expect, test } from "bun:test";
import type { ImageRef } from "../../../../src/common/protocol.ts";
import {
	rememberOutboundImage,
	resolveReplyImages,
	type TelegramMessageImageRecord,
} from "../../../../src/frontend/telegram/media/message-image-ref.ts";

describe("resolveReplyImages", () => {
	test("returns empty when no reply message", async () => {
		const result = await resolveReplyImages(123, undefined);
		expect(result).toEqual([]);
	});

	test("returns empty when no resolver provided", async () => {
		const result = await resolveReplyImages(123, { message_id: 1 });
		expect(result).toEqual([]);
	});

	test("returns resolved image when found", async () => {
		const image: ImageRef = { path: "/tmp/cat.png", mediaType: "image/png" };
		const resolver = async (_chatId: number, _msgId: number) => image;

		const result = await resolveReplyImages(123, { message_id: 42 }, resolver);
		expect(result).toEqual([image]);
	});

	test("returns empty when resolver returns undefined", async () => {
		const resolver = async () => undefined;
		const result = await resolveReplyImages(123, { message_id: 42 }, resolver);
		expect(result).toEqual([]);
	});

	test("passes correct chatId and messageId to resolver", async () => {
		let receivedChat = 0;
		let receivedMsg = 0;
		const resolver = async (chatId: number, msgId: number) => {
			receivedChat = chatId;
			receivedMsg = msgId;
			return undefined;
		};

		await resolveReplyImages(999, { message_id: 55 }, resolver);
		expect(receivedChat).toBe(999);
		expect(receivedMsg).toBe(55);
	});
});

describe("rememberOutboundImage", () => {
	test("does nothing when no callback provided", async () => {
		// Should not throw
		await rememberOutboundImage(123, 1, { type: "image", path: "/tmp/a.png" });
	});

	test("calls callback with correct record", async () => {
		const records: TelegramMessageImageRecord[] = [];
		const remember = async (record: TelegramMessageImageRecord) => {
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
			image: { path: "/tmp/chart.png", mediaType: "image/png" },
			direction: "outbound",
		});
	});
});
