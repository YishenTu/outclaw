import { InputFile } from "grammy";
import type { ImageEvent, ImageRef } from "../../../common/protocol.ts";
import {
	markdownToTelegramHtml,
	splitTelegramHtml,
	TELEGRAM_MESSAGE_LIMIT,
} from "../format.ts";

const EDIT_THROTTLE_MS = 1_000;

interface TelegramPromptContext {
	chatId: number;
	replyWithChatAction(action: "typing"): Promise<unknown>;
	replyWithPhoto(
		photo: InputFile,
		options: {
			caption?: string;
			disable_notification: boolean;
		},
	): Promise<{ message_id: number }>;
	sendMessage(
		text: string,
		options: { parse_mode?: string; disable_notification?: boolean },
	): Promise<{ message_id: number }>;
	editMessageText(
		messageId: number,
		text: string,
		options: { parse_mode?: string },
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

async function sendHtmlChunks(
	ctx: TelegramPromptContext,
	html: string,
): Promise<void> {
	const chunks = splitTelegramHtml(html, TELEGRAM_MESSAGE_LIMIT);
	for (const chunk of chunks) {
		await ctx.sendMessage(chunk, {
			parse_mode: "HTML",
			disable_notification: true,
		});
	}
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

		let accumulated = "";
		let messageId: number | undefined;
		let lastEditTime = 0;
		let lastSentHtml = "";

		for await (const chunk of stream) {
			accumulated += chunk;

			const now = Date.now();
			if (now - lastEditTime < EDIT_THROTTLE_MS) continue;

			const html = markdownToTelegramHtml(accumulated);
			if (!html || html === lastSentHtml) continue;

			// Mid-stream: only use the first chunk for the preview message.
			// Full chunking happens at the end.
			const preview = splitTelegramHtml(html, TELEGRAM_MESSAGE_LIMIT)[0];
			if (!preview || preview === lastSentHtml) continue;

			if (messageId === undefined) {
				const sent = await ctx.sendMessage(preview, {
					parse_mode: "HTML",
					disable_notification: true,
				});
				messageId = sent.message_id;
				lastSentHtml = preview;
			} else {
				const ok = await ctx
					.editMessageText(messageId, preview, {
						parse_mode: "HTML",
					})
					.then(() => true)
					.catch(() => false);
				if (ok) lastSentHtml = preview;
			}
			lastEditTime = Date.now();
		}

		if (!accumulated) return;

		const html = markdownToTelegramHtml(accumulated);
		if (!html) return;

		const chunks = splitTelegramHtml(html, TELEGRAM_MESSAGE_LIMIT);
		if (chunks.length === 0) return;

		// Final delivery: edit existing message with first chunk, send rest as new.
		const first = chunks[0] as string;

		if (messageId === undefined) {
			await sendHtmlChunks(ctx, html);
		} else {
			let startIndex = 1;
			if (first !== lastSentHtml) {
				const editOk = await ctx
					.editMessageText(messageId, first, {
						parse_mode: "HTML",
					})
					.then(() => true)
					.catch(() => false);
				if (!editOk) {
					// Edit failed — send all chunks as new messages.
					startIndex = 0;
				}
			}
			for (let i = startIndex; i < chunks.length; i++) {
				await ctx.sendMessage(chunks[i] as string, {
					parse_mode: "HTML",
					disable_notification: true,
				});
			}
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
