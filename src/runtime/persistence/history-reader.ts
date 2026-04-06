import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";

interface DisplayMessage {
	role: "user" | "assistant";
	content: string;
}

export async function readHistory(
	sdkSessionId: string,
): Promise<DisplayMessage[]> {
	const messages = await getSessionMessages(sdkSessionId);
	const result: DisplayMessage[] = [];

	for (const msg of messages) {
		const m = msg.message as {
			role: string;
			content: string | Array<{ type: string; text?: string }>;
		};

		if (msg.type === "user" && typeof m.content === "string") {
			result.push({ role: "user", content: m.content });
		}

		if (msg.type === "assistant" && Array.isArray(m.content)) {
			const text = m.content
				.filter((b) => b.type === "text" && b.text)
				.map((b) => b.text)
				.join("");
			if (text) {
				result.push({ role: "assistant", content: text });
			}
		}
	}

	return result;
}
