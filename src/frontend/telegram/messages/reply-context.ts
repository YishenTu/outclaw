import { createReplyContext } from "../../../common/reply-context.ts";

export function extractReplyText(replyToMessage?: {
	text?: string;
	caption?: string;
}): string | undefined {
	if (!replyToMessage) return undefined;
	return replyToMessage.text ?? replyToMessage.caption ?? undefined;
}

export function extractReplyContext(replyToMessage?: {
	text?: string;
	caption?: string;
}) {
	return createReplyContext(extractReplyText(replyToMessage));
}
