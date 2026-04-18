import { isOperationalHeartbeatPrompt } from "./heartbeat-prompt.ts";
import type { TranscriptTurn } from "./protocol.ts";

interface FormatTranscriptTurnBodyOptions {
	includeImagePlaceholders?: boolean;
}

export function formatTranscriptTurnBody(
	turn: TranscriptTurn,
	options: FormatTranscriptTurnBodyOptions = {},
): string {
	const parts: string[] = [];
	if (turn.replyContext?.text) {
		parts.push(`> ${turn.replyContext.text}`);
	}
	if (turn.content) {
		parts.push(turn.content);
	} else if (
		options.includeImagePlaceholders &&
		(turn.images?.length ?? 0) > 0
	) {
		parts.push(`[images: ${turn.images?.length ?? 0}]`);
	}
	return parts.join("\n");
}

export function formatSearchTranscriptTurnBody(turn: TranscriptTurn): string {
	const bodyText = formatTranscriptTurnBody(turn);
	if (bodyText === "") {
		return "";
	}
	if (
		turn.source === "heartbeat" ||
		isOperationalHeartbeatPrompt(turn.content)
	) {
		return "";
	}
	if (turn.role === "assistant" && isExactHeartbeatOk(bodyText)) {
		return "";
	}
	return bodyText;
}

function isExactHeartbeatOk(bodyText: string): boolean {
	const withoutWrappingBackticks = bodyText
		.trim()
		.replace(/^`+/, "")
		.replace(/`+$/, "")
		.trim();
	return withoutWrappingBackticks === "HEARTBEAT_OK";
}
