import { InputFile } from "grammy";
import type { ImageEvent, ImageRef } from "../../../common/protocol.ts";
import type { StreamChunk } from "../bridge/client.ts";
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
	): AsyncIterable<StreamChunk>;
}

interface DraftState {
	accumulated: string;
	messageId: number | undefined;
	lastSentHtml: string;
}

function createDraft(): DraftState {
	return { accumulated: "", messageId: undefined, lastSentHtml: "" };
}

function wrapThinking(html: string): string {
	return html ? `<blockquote expandable>${html}</blockquote>` : "";
}

async function sendOrEdit(
	ctx: TelegramPromptContext,
	draft: DraftState,
	html: string,
): Promise<boolean> {
	const preview = splitTelegramHtml(html, TELEGRAM_MESSAGE_LIMIT)[0];
	if (!preview || preview === draft.lastSentHtml) return false;

	if (draft.messageId === undefined) {
		const sent = await ctx.sendMessage(preview, {
			parse_mode: "HTML",
			disable_notification: true,
		});
		draft.messageId = sent.message_id;
		draft.lastSentHtml = preview;
	} else {
		const ok = await ctx
			.editMessageText(draft.messageId, preview, { parse_mode: "HTML" })
			.then(() => true)
			.catch(() => false);
		if (ok) draft.lastSentHtml = preview;
	}
	return true;
}

async function finalizeDraft(
	ctx: TelegramPromptContext,
	draft: DraftState,
	html: string,
): Promise<void> {
	const chunks = splitTelegramHtml(html, TELEGRAM_MESSAGE_LIMIT);
	if (chunks.length === 0) return;

	const first = chunks[0] as string;

	if (draft.messageId === undefined) {
		for (const chunk of chunks) {
			await ctx.sendMessage(chunk, {
				parse_mode: "HTML",
				disable_notification: true,
			});
		}
	} else {
		let startIndex = 1;
		if (first !== draft.lastSentHtml) {
			const editOk = await ctx
				.editMessageText(draft.messageId, first, { parse_mode: "HTML" })
				.then(() => true)
				.catch(() => false);
			if (!editOk) startIndex = 0;
		}
		for (let i = startIndex; i < chunks.length; i++) {
			await ctx.sendMessage(chunks[i] as string, {
				parse_mode: "HTML",
				disable_notification: true,
			});
		}
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

		const thinking = createDraft();
		const response = createDraft();
		let lastEditTime = 0;

		for await (const chunk of stream) {
			const isThinking = chunk.type === "thinking";
			const draft = isThinking ? thinking : response;
			draft.accumulated += chunk.text;

			const now = Date.now();
			if (now - lastEditTime < EDIT_THROTTLE_MS) continue;

			const html = isThinking
				? wrapThinking(markdownToTelegramHtml(draft.accumulated))
				: markdownToTelegramHtml(draft.accumulated);
			if (!html) continue;

			if (await sendOrEdit(ctx, draft, html)) {
				lastEditTime = Date.now();
			}
		}

		// Finalize thinking bubble
		if (thinking.accumulated) {
			const html = wrapThinking(markdownToTelegramHtml(thinking.accumulated));
			if (html) {
				await finalizeDraft(ctx, thinking, html);
			}
		}

		// Finalize response bubble
		if (response.accumulated) {
			const html = markdownToTelegramHtml(response.accumulated);
			if (html) {
				await finalizeDraft(ctx, response, html);
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
