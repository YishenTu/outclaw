import type { ImageEvent, ImageRef } from "../../common/protocol.ts";
import { getImageInfo } from "./image-info.ts";

export type TelegramMediaDirection = "inbound" | "outbound";

export interface TelegramMessageImageRecord {
	chatId: number;
	messageId: number;
	image: ImageRef;
	direction: TelegramMediaDirection;
}

export interface TelegramMessageImageOptions {
	resolveMessageImage?: (
		chatId: number,
		messageId: number,
	) => Promise<ImageRef | undefined>;
	rememberMessageImage?: (record: TelegramMessageImageRecord) => Promise<void>;
}

export async function resolveReplyImages(
	chatId: number,
	replyToMessage: { message_id: number } | undefined,
	resolveMessageImage?: (
		chatId: number,
		messageId: number,
	) => Promise<ImageRef | undefined>,
): Promise<ImageRef[]> {
	if (!replyToMessage || !resolveMessageImage) {
		return [];
	}

	const image = await resolveMessageImage(chatId, replyToMessage.message_id);
	return image ? [image] : [];
}

export async function rememberOutboundImage(
	chatId: number,
	messageId: number,
	event: ImageEvent,
	rememberMessageImage?: (record: TelegramMessageImageRecord) => Promise<void>,
) {
	if (!rememberMessageImage) {
		return;
	}

	await rememberMessageImage({
		chatId,
		messageId,
		image: {
			path: event.path,
			mediaType: getImageInfo(event.path).mediaType,
		},
		direction: "outbound",
	});
}
