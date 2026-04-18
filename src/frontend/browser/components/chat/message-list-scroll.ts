import type { DisplayMessage } from "../../../../common/protocol.ts";

const BOTTOM_STICKY_TOLERANCE_PX = 32;

interface TranscriptAutoScrollTokenParams {
	sessionKey: string | null;
	messages: DisplayMessage[];
	streamingText: string;
	streamingThinking: string;
	isStreaming: boolean;
}

interface TranscriptScrollMetrics {
	scrollTop: number;
	clientHeight: number;
	scrollHeight: number;
}

export function createTranscriptAutoScrollToken(
	params: TranscriptAutoScrollTokenParams,
): string {
	return [
		params.sessionKey ?? "",
		params.messages.map(displayMessageKey).join("\u0001"),
		params.streamingThinking,
		params.streamingText,
		params.isStreaming ? "streaming" : "idle",
	].join("\u0002");
}

export function displayMessageKey(message: DisplayMessage): string {
	if (message.kind === "system") {
		return `system:${message.event}:${message.text}`;
	}

	return [
		"chat",
		message.role,
		message.content,
		message.replyContext?.text ?? "",
		message.thinking ?? "",
		message.images
			?.map((image) => image.path ?? image.mediaType ?? "image")
			.join("|") ?? "",
	].join(":");
}

export function isNearTranscriptBottom(
	metrics: TranscriptScrollMetrics,
): boolean {
	return (
		metrics.scrollHeight - (metrics.scrollTop + metrics.clientHeight) <=
		BOTTOM_STICKY_TOLERANCE_PX
	);
}
