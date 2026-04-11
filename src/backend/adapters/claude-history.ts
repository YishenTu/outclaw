import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import type {
	DisplayImage,
	DisplayMessage,
	ImageMediaType,
} from "../../common/protocol.ts";

interface HistoryBlock {
	type: string;
	source?: {
		media_type?: ImageMediaType;
	};
	text?: string;
	thinking?: string;
}

export async function readClaudeHistory(
	sdkSessionId: string,
): Promise<DisplayMessage[]> {
	const messages = await getSessionMessages(sdkSessionId);
	const result: DisplayMessage[] = [];
	let pendingThinking = "";

	for (const msg of messages) {
		const message = msg.message as {
			content: string | HistoryBlock[];
		};

		if (
			pendingThinking &&
			msg.type === "user" &&
			isDisplayableUserContent(message.content)
		) {
			result.push({
				role: "assistant",
				content: "",
				thinking: pendingThinking,
			});
			pendingThinking = "";
		}

		if (msg.type === "user" && typeof message.content === "string") {
			result.push({ role: "user", content: message.content });
		}

		if (msg.type === "user" && Array.isArray(message.content)) {
			const content = extractText(message.content);
			const images = extractImages(message.content);
			if (content || images.length > 0) {
				result.push({
					role: "user",
					content,
					images: images.length > 0 ? images : undefined,
				});
			}
		}

		if (msg.type === "assistant" && Array.isArray(message.content)) {
			const text = extractText(message.content);
			const thinking = extractThinking(message.content);

			if (thinking && !text) {
				pendingThinking += thinking;
				continue;
			}

			if (text) {
				const merged = [pendingThinking, thinking].join("") || undefined;
				pendingThinking = "";
				result.push({
					role: "assistant",
					content: text,
					thinking: merged,
				});
			}
		}
	}

	if (pendingThinking) {
		result.push({ role: "assistant", content: "", thinking: pendingThinking });
	}

	return result;
}

function isDisplayableUserContent(content: string | HistoryBlock[]): boolean {
	if (typeof content === "string") {
		return content.length > 0;
	}

	return content.some((block) => block.type !== "tool_result");
}

function extractImages(blocks: HistoryBlock[]): DisplayImage[] {
	return blocks
		.filter((block) => block.type === "image")
		.map((block) => ({
			mediaType: block.source?.media_type,
		}));
}

function extractText(blocks: HistoryBlock[]): string {
	return blocks
		.filter((block) => block.type === "text" && block.text)
		.map((block) => block.text)
		.join("");
}

function extractThinking(blocks: HistoryBlock[]): string {
	return blocks
		.filter((block) => block.type === "thinking" && block.thinking)
		.map((block) => block.thinking)
		.join("");
}
