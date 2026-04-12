import type { ImageEvent, ImageRef } from "../../../common/protocol.ts";
import { getImageInfo } from "./image-info.ts";

export type TelegramFileDirection = "inbound" | "outbound";

export interface TelegramDocumentFileRef {
	path: string;
	displayName: string;
}

export type TelegramMessageFile =
	| {
			kind: "image";
			image: ImageRef;
	  }
	| {
			kind: "document";
			document: TelegramDocumentFileRef;
	  };

export interface TelegramMessageFileRecord {
	chatId: number;
	messageId: number;
	file: TelegramMessageFile;
	direction: TelegramFileDirection;
}

export interface TelegramMessageFileOptions {
	resolveMessageFile?: (
		chatId: number,
		messageId: number,
	) => Promise<TelegramMessageFile | undefined>;
	rememberMessageFile?: (record: TelegramMessageFileRecord) => Promise<void>;
}

export interface TelegramReplyAttachments {
	images: ImageRef[];
	promptSegments: string[];
}

export async function resolveReplyAttachments(
	chatId: number,
	replyToMessage: { message_id: number } | undefined,
	resolveMessageFile?: (
		chatId: number,
		messageId: number,
	) => Promise<TelegramMessageFile | undefined>,
): Promise<TelegramReplyAttachments> {
	if (!replyToMessage || !resolveMessageFile) {
		return { images: [], promptSegments: [] };
	}

	const file = await resolveMessageFile(chatId, replyToMessage.message_id);
	if (!file) {
		return { images: [], promptSegments: [] };
	}

	if (file.kind === "image") {
		return { images: [file.image], promptSegments: [] };
	}

	return {
		images: [],
		promptSegments: [formatTelegramDocumentPromptRef(file.document)],
	};
}

export function formatTelegramDocumentPromptRef(
	document: TelegramDocumentFileRef,
): string {
	return `[file: ${document.displayName} -> ${document.path}]`;
}

export function appendPromptSegments(
	prompt: string,
	promptSegments: string[],
): string {
	const parts: string[] = [];
	if (prompt) {
		parts.push(prompt);
	}
	for (const segment of promptSegments) {
		if (segment) {
			parts.push(segment);
		}
	}
	return parts.join("\n\n");
}

export async function rememberOutboundImage(
	chatId: number,
	messageId: number,
	event: ImageEvent,
	rememberMessageFile?: (record: TelegramMessageFileRecord) => Promise<void>,
) {
	if (!rememberMessageFile) {
		return;
	}

	await rememberMessageFile({
		chatId,
		messageId,
		file: {
			kind: "image",
			image: {
				path: event.path,
				mediaType: getImageInfo(event.path).mediaType,
			},
		},
		direction: "outbound",
	});
}
