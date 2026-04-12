import { describe, expect, mock, test } from "bun:test";
import { sendTelegramHeartbeatResult } from "../../../../src/frontend/telegram/messages/heartbeat-result.ts";

describe("sendTelegramHeartbeatResult", () => {
	test("sends buffered heartbeat images and text to telegram", async () => {
		const sendMessage = mock(async () => ({}));
		const sendPhoto = mock(async () => ({ message_id: 77 }));
		const rememberMessageFile = mock(async () => {});

		await sendTelegramHeartbeatResult(
			{
				sendMessage,
				sendPhoto,
			},
			{
				telegramChatId: 123,
				text: "heartbeat summary",
				images: [{ path: "/tmp/chart.png", caption: "chart" }],
				rememberMessageFile,
			},
		);

		expect(sendPhoto).toHaveBeenCalledWith(123, "/tmp/chart.png", {
			caption: "chart",
			disable_notification: true,
		});
		expect(rememberMessageFile).toHaveBeenCalledWith({
			chatId: 123,
			messageId: 77,
			file: {
				kind: "image",
				image: {
					path: "/tmp/chart.png",
					mediaType: "image/png",
				},
			},
			direction: "outbound",
		});
		expect(sendMessage).toHaveBeenCalledWith(123, "heartbeat summary", {
			parse_mode: "HTML",
			disable_notification: true,
		});
	});

	test("skips empty text messages", async () => {
		const sendMessage = mock(async () => ({}));
		const sendPhoto = mock(async () => ({ message_id: 1 }));

		await sendTelegramHeartbeatResult(
			{
				sendMessage,
				sendPhoto,
			},
			{
				telegramChatId: 123,
				text: "",
				images: [],
			},
		);

		expect(sendPhoto).not.toHaveBeenCalled();
		expect(sendMessage).not.toHaveBeenCalled();
	});

	test("skips HEARTBEAT_OK text messages", async () => {
		const sendMessage = mock(async () => ({}));
		const sendPhoto = mock(async () => ({ message_id: 77 }));

		await sendTelegramHeartbeatResult(
			{
				sendMessage,
				sendPhoto,
			},
			{
				telegramChatId: 123,
				text: "  HEARTBEAT_OK  ",
				images: [{ path: "/tmp/chart.png" }],
			},
		);

		expect(sendPhoto).toHaveBeenCalledWith(123, "/tmp/chart.png", {
			caption: undefined,
			disable_notification: true,
		});
		expect(sendMessage).not.toHaveBeenCalled();
	});

	test("converts markdown to HTML in text messages", async () => {
		const sendMessage = mock(async () => ({}));
		const sendPhoto = mock(async () => ({ message_id: 1 }));

		await sendTelegramHeartbeatResult(
			{
				sendMessage,
				sendPhoto,
			},
			{
				telegramChatId: 123,
				text: "**bold** result",
				images: [],
			},
		);

		expect(sendMessage).toHaveBeenCalledWith(123, "<b>bold</b> result", {
			parse_mode: "HTML",
			disable_notification: true,
		});
	});

	test("splits long text into multiple messages", async () => {
		const sendMessage = mock(async () => ({}));
		const sendPhoto = mock(async () => ({ message_id: 1 }));

		const longText = `${"word ".repeat(900)}end`;

		await sendTelegramHeartbeatResult(
			{
				sendMessage,
				sendPhoto,
			},
			{
				telegramChatId: 123,
				text: longText,
				images: [],
			},
		);

		expect(sendMessage.mock.calls.length).toBeGreaterThan(1);
		for (const call of sendMessage.mock.calls) {
			const text = (call as unknown as [number, string, object])[1];
			expect(text.length).toBeLessThanOrEqual(4096);
		}
	});

	test("skips backtick-wrapped HEARTBEAT_OK", async () => {
		const sendMessage = mock(async () => ({}));
		const sendPhoto = mock(async () => ({ message_id: 1 }));

		await sendTelegramHeartbeatResult(
			{
				sendMessage,
				sendPhoto,
			},
			{
				telegramChatId: 123,
				text: "`HEARTBEAT_OK`",
				images: [],
			},
		);

		expect(sendMessage).not.toHaveBeenCalled();
	});
});
