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

export async function readHistory(
	sdkSessionId: string,
): Promise<DisplayMessage[]> {
	const messages = await getSessionMessages(sdkSessionId);
	const result: DisplayMessage[] = [];
	let pendingThinking = "";

	for (const msg of messages) {
		const m = msg.message as {
			role: string;
			content: string | HistoryBlock[];
		};

		if (
			pendingThinking &&
			msg.type === "user" &&
			isDisplayableUserContent(m.content)
		) {
			result.push({
				role: "assistant",
				content: "",
				thinking: pendingThinking,
			});
			pendingThinking = "";
		}

		if (msg.type === "user" && typeof m.content === "string") {
			result.push({ role: "user", content: m.content });
		}

		if (msg.type === "user" && Array.isArray(m.content)) {
			const content = extractText(m.content);
			const images = extractImages(m.content);
			if (content || images.length > 0) {
				result.push({
					role: "user",
					content,
					images: images.length > 0 ? images : undefined,
				});
			}
		}

		if (msg.type === "assistant" && Array.isArray(m.content)) {
			const text = extractText(m.content);
			const thinking = extractThinking(m.content);

			if (thinking && !text) {
				// Thinking-only entry — buffer for merging with the next text entry
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

	// Flush any trailing thinking-only entry
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
