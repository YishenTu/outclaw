import type {
	DisplayChatMessage,
	DisplayImage,
	ReplyContext,
} from "../../../common/protocol.ts";

export { formatContext, formatStatus } from "../../../common/status.ts";

export function formatImage(image: DisplayImage): string {
	return image.path ? `[image: ${image.path}]` : "[image]";
}

export function formatLivePrompt(
	source: string,
	prompt: string,
	images: DisplayImage[] | undefined,
): string {
	const lines: string[] = [];
	const prefix = `[${source}] `;

	if (prompt) {
		lines.push(`${prefix}${prompt}`);
	}

	for (const image of images ?? []) {
		lines.push(`${prefix}${formatImage(image)}`);
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

	for (const image of message.images ?? []) {
		lines.push(`> ${formatImage(image)}`);
	}

	return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

export function formatReplyText(replyContext: ReplyContext): string {
	return replyContext.text;
}
