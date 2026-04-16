import { INDEX_FILTERED_HEARTBEAT_PROMPTS } from "./heartbeat-prompt.ts";
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
	if (isOperationalHeartbeatPrompt(turn.content)) {
		return "";
	}
	if (turn.role === "assistant" && isExactHeartbeatOk(bodyText)) {
		return "";
	}
	return bodyText;
}

const normalizedHeartbeatPrompts = new Set(
	INDEX_FILTERED_HEARTBEAT_PROMPTS.map(normalizeWhitespace),
);

function isOperationalHeartbeatPrompt(content: string): boolean {
	return normalizedHeartbeatPrompts.has(normalizeWhitespace(content));
}

function isExactHeartbeatOk(bodyText: string): boolean {
	const withoutWrappingBackticks = bodyText
		.trim()
		.replace(/^`+/, "")
		.replace(/`+$/, "")
		.trim();
	return withoutWrappingBackticks === "HEARTBEAT_OK";
}

function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}
