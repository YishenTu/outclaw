import type {
	ImageEvent,
	ImageRef,
	ReplyContext,
} from "../../common/protocol.ts";
import type { StreamChunk, TelegramBridgeRouting } from "./bridge/client.ts";

export interface TelegramBridgeLike {
	close(): void;
	sendCommandAndWait(
		command: string,
		expectedTypes?: ReadonlySet<string>,
		routing?: TelegramBridgeRouting,
	): Promise<{ type: string; [key: string]: unknown }>;
	stream(
		prompt: string,
		images?: ImageRef[],
		onImage?: (event: ImageEvent) => void | Promise<void>,
		telegramChatId?: number,
		replyContext?: ReplyContext,
		routing?: TelegramBridgeRouting,
	): AsyncIterable<StreamChunk>;
}

export type TelegramBridgeFactory = (ctx: {
	from?: { id: number };
}) => TelegramBridgeLike;

export function createTelegramContextBridge(params: {
	botId: string;
	bridge: TelegramBridgeLike;
	from?: { id: number };
}): TelegramBridgeLike {
	const routing = {
		telegramBotId: params.botId,
		telegramUserId: params.from?.id,
	};

	return {
		close: () => undefined,
		sendCommandAndWait: (command, expectedTypes) =>
			params.bridge.sendCommandAndWait(command, expectedTypes, routing),
		stream: (prompt, images, onImage, telegramChatId, replyContext) =>
			params.bridge.stream(
				prompt,
				images,
				onImage,
				telegramChatId,
				replyContext,
				routing,
			),
	};
}
