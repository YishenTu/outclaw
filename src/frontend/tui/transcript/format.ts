import type {
	DisplayChatMessage,
	DisplayImage,
	ReplyContext,
} from "../../../common/protocol.ts";

export { formatContext, formatStatus } from "../../../common/status.ts";

export function formatImage(
	_image: DisplayImage,
	index?: number,
	total = 1,
): string {
	if (total > 1 && index !== undefined) {
		return `[image ${index + 1}]`;
	}
	return "[image]";
}

export function formatLivePrompt(
	source: string,
	prompt: string,
	images: DisplayImage[] | undefined,
): string {
	const lines: string[] = [];
	const prefix = source === "browser" || source === "tui" ? "" : `[${source}] `;

	if (prompt) {
		lines.push(`${prefix}${prompt}`);
	}

	const imageCount = images?.length ?? 0;
	for (const [index, image] of (images ?? []).entries()) {
		lines.push(`${prefix}${formatImage(image, index, imageCount)}`);
	}

	return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

export function formatReplayMessage(message: DisplayChatMessage): string {
	if (message.role === "assistant") {
		return `${message.content}\n`;
	}

	const lines: string[] = [];
	if (message.content) {
		lines.push(`> ${message.content}`);
	}

	const imageCount = message.images?.length ?? 0;
	for (const [index, image] of (message.images ?? []).entries()) {
		lines.push(`> ${formatImage(image, index, imageCount)}`);
	}

	return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

export function formatReplyText(replyContext: ReplyContext): string {
	return replyContext.text;
}
