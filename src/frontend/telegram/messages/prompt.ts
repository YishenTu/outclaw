import { InputFile } from "grammy";
import {
	assistantTextSegment,
	assistantThinkingSegment,
	canMergeAssistantMessageSegments,
} from "../../../common/assistant-message-segments.ts";
import type {
	AssistantMessageSegment,
	ImageEvent,
	ImageRef,
	ReplyContext,
} from "../../../common/protocol.ts";
import type { StreamChunk } from "../bridge/client.ts";
import {
	hasTelegramVisibleText,
	markdownToTelegramHtml,
	splitTelegramVisibleHtml,
	TELEGRAM_MESSAGE_LIMIT,
} from "../format.ts";

const EDIT_THROTTLE_MS = 1_000;

export interface TelegramPromptContext {
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
	replyContext?: ReplyContext;
	rememberSentImage?(
		messageId: number,
		event: ImageEvent,
	): void | Promise<void>;
	streamPrompt(
		prompt: string,
		images?: ImageRef[],
		onImage?: (event: ImageEvent) => void | Promise<void>,
		replyContext?: ReplyContext,
	): AsyncIterable<StreamChunk>;
}

interface DraftState {
	accumulated: string;
	messageId: number | undefined;
	lastSentHtml: string;
}

interface SegmentDraft {
	segment: AssistantMessageSegment;
	draft: DraftState;
	finalized: boolean;
}

function createDraft(): DraftState {
	return { accumulated: "", messageId: undefined, lastSentHtml: "" };
}

function wrapThinking(html: string): string {
	return html ? `<blockquote expandable>${html}</blockquote>` : "";
}

function htmlForSegment(segment: AssistantMessageSegment): string {
	const html = markdownToTelegramHtml(segment.text);
	return segment.type === "thinking" ? wrapThinking(html) : html;
}

async function sendOrEdit(
	ctx: TelegramPromptContext,
	draft: DraftState,
	html: string,
): Promise<boolean> {
	const preview = splitTelegramVisibleHtml(html, TELEGRAM_MESSAGE_LIMIT)[0];
	if (
		!preview ||
		!hasTelegramVisibleText(preview) ||
		preview === draft.lastSentHtml
	) {
		return false;
	}

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
	const chunks = splitTelegramVisibleHtml(html, TELEGRAM_MESSAGE_LIMIT);
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
			options.replyContext,
		);

		const segmentDrafts: SegmentDraft[] = [];
		let lastEditTime = 0;

		for await (const chunk of stream) {
			if (chunk.type === "compacting_started") {
				await ctx.sendMessage("Compacting context...", {
					disable_notification: true,
				});
				continue;
			}
			if (chunk.type === "compacting_finished") {
				await ctx.sendMessage("Context compacted.", {
					disable_notification: true,
				});
				continue;
			}
			if (chunk.type === "action_boundary") {
				for (const segmentDraft of segmentDrafts) {
					await finalizeSegmentDraft(ctx, segmentDraft);
				}
				segmentDrafts.length = 0;
				continue;
			}

			if (chunk.type !== "thinking" && chunk.type !== "text") {
				continue;
			}

			const segment = streamChunkToSegment(chunk);
			let current = segmentDrafts.at(-1);
			if (
				current &&
				!canMergeAssistantMessageSegments(current.segment, segment)
			) {
				await finalizeSegmentDraft(ctx, current);
				current = undefined;
			}
			if (!current) {
				current = {
					segment: { ...segment, text: "" },
					draft: createDraft(),
					finalized: false,
				};
				segmentDrafts.push(current);
			}
			current.segment = {
				...segment,
				text: current.segment.text + segment.text,
			};
			current.draft.accumulated = current.segment.text;

			const now = Date.now();
			if (now - lastEditTime < EDIT_THROTTLE_MS) continue;

			const html = htmlForSegment(current.segment);
			if (!html) continue;

			if (await sendOrEdit(ctx, current.draft, html)) {
				lastEditTime = Date.now();
			}
		}

		for (const segmentDraft of segmentDrafts) {
			await finalizeSegmentDraft(ctx, segmentDraft);
		}
	} finally {
		clearInterval(typingInterval);
	}
}

function streamChunkToSegment(
	chunk: Extract<StreamChunk, { type: "thinking" | "text" }>,
): AssistantMessageSegment {
	if (chunk.type === "text") {
		return assistantTextSegment(chunk.text);
	}
	return assistantThinkingSegment(chunk.text, chunk.blockId);
}

async function finalizeSegmentDraft(
	ctx: TelegramPromptContext,
	segmentDraft: SegmentDraft,
): Promise<void> {
	if (segmentDraft.finalized) {
		return;
	}
	const html = htmlForSegment(segmentDraft.segment);
	if (html) {
		await finalizeDraft(ctx, segmentDraft.draft, html);
	}
	segmentDraft.finalized = true;
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
