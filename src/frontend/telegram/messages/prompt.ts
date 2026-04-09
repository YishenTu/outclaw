import { InputFile } from "grammy";
import type { ImageEvent, ImageRef } from "../../../common/protocol.ts";

interface TelegramPromptContext {
	replyWithChatAction(action: "typing"): Promise<unknown>;
	replyWithPhoto(
		photo: InputFile,
		options: {
			caption?: string;
			disable_notification: boolean;
		},
	): Promise<{ message_id: number }>;
	replyWithStream(
		iterable: AsyncIterable<string>,
		placeholder: undefined,
		options: {
			disable_notification: boolean;
		},
	): Promise<unknown>;
}

interface RunTelegramPromptOptions {
	prompt: string;
	images?: ImageRef[];
	rememberSentImage?(
		messageId: number,
		event: ImageEvent,
	): void | Promise<void>;
	streamPrompt(
		prompt: string,
		images?: ImageRef[],
		onImage?: (event: ImageEvent) => void | Promise<void>,
	): AsyncIterable<string>;
}

export async function runTelegramPrompt(
	ctx: TelegramPromptContext,
	options: RunTelegramPromptOptions,
) {
	await ctx.replyWithChatAction("typing");
	const typingInterval = setInterval(() => {
		void ctx.replyWithChatAction("typing").catch(() => {});
	}, 4000);

	try {
		const stream = options.streamPrompt(
			options.prompt,
			options.images,
			(event) => sendImage(ctx, event, options.rememberSentImage),
		);
		const iterator = stream[Symbol.asyncIterator]();
		const firstChunk = await iterator.next();

		if (!firstChunk.done) {
			await ctx.replyWithStream(
				prependChunk(firstChunk.value, iterator),
				undefined,
				{
					disable_notification: true,
				},
			);
		}
	} finally {
		clearInterval(typingInterval);
	}
}

async function sendImage(
	ctx: TelegramPromptContext,
	event: ImageEvent,
	rememberSentImage?:
		| ((messageId: number, event: ImageEvent) => void | Promise<void>)
		| undefined,
) {
	const message = await ctx.replyWithPhoto(new InputFile(event.path), {
		caption: event.caption,
		disable_notification: true,
	});
	await rememberSentImage?.(message.message_id, event);
}

async function* prependChunk(
	firstChunk: string,
	iterator: AsyncIterator<string>,
): AsyncIterable<string> {
	yield firstChunk;

	while (true) {
		const nextChunk = await iterator.next();
		if (nextChunk.done) {
			return;
		}
		yield nextChunk.value;
	}
}
