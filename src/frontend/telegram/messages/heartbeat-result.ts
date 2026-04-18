import { isHeartbeatNoopResult } from "../../../common/heartbeat-prompt.ts";
import { getImageInfo } from "../files/image-info.ts";
import type { TelegramMessageFileRecord } from "../files/message-file-ref.ts";
import {
	markdownToTelegramHtml,
	splitTelegramHtml,
	TELEGRAM_MESSAGE_LIMIT,
} from "../format.ts";

interface TelegramHeartbeatResultContext {
	sendMessage(
		chatId: number,
		text: string,
		options: {
			parse_mode?: string;
			disable_notification: boolean;
		},
	): Promise<unknown>;
	sendPhoto(
		chatId: number,
		path: string,
		options: {
			caption?: string;
			disable_notification: boolean;
		},
	): Promise<{ message_id: number }>;
}

interface TelegramHeartbeatResultParams {
	telegramChatId: number;
	text: string;
	images: Array<{
		path: string;
		caption?: string;
	}>;
	rememberMessageFile?: (params: TelegramMessageFileRecord) => Promise<void>;
}

function shouldSendHeartbeatText(text: string): boolean {
	return text.trim() !== "" && !isHeartbeatNoopResult(text);
}

export async function sendTelegramHeartbeatResult(
	ctx: TelegramHeartbeatResultContext,
	params: TelegramHeartbeatResultParams,
) {
	for (const image of params.images) {
		const message = await ctx.sendPhoto(params.telegramChatId, image.path, {
			caption: image.caption,
			disable_notification: true,
		});
		await params.rememberMessageFile?.({
			chatId: params.telegramChatId,
			messageId: message.message_id,
			file: {
				kind: "image",
				image: {
					path: image.path,
					mediaType: getImageInfo(image.path).mediaType,
				},
			},
			direction: "outbound",
		});
	}

	if (!shouldSendHeartbeatText(params.text)) {
		return;
	}

	const html = markdownToTelegramHtml(params.text);
	const chunks = splitTelegramHtml(html || params.text, TELEGRAM_MESSAGE_LIMIT);
	for (const chunk of chunks) {
		await ctx.sendMessage(params.telegramChatId, chunk, {
			parse_mode: "HTML",
			disable_notification: true,
		});
	}
}
