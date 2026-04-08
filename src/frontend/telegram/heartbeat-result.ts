import type { ImageRef } from "../../common/protocol.ts";
import { getImageInfo } from "./image-info.ts";

interface TelegramHeartbeatResultContext {
	sendMessage(
		chatId: number,
		text: string,
		options: {
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
	rememberMessageImage?: (params: {
		chatId: number;
		messageId: number;
		image: ImageRef;
		direction: "outbound";
	}) => Promise<void>;
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
		await params.rememberMessageImage?.({
			chatId: params.telegramChatId,
			messageId: message.message_id,
			image: {
				path: image.path,
				mediaType: getImageInfo(image.path).mediaType,
			},
			direction: "outbound",
		});
	}

	if (params.text.trim() === "") {
		return;
	}

	await ctx.sendMessage(params.telegramChatId, params.text, {
		disable_notification: true,
	});
}
