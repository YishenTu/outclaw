import type {
	DisplayChatMessage,
	DisplayMessage,
} from "../../../../common/protocol.ts";

const BOTTOM_STICKY_TOLERANCE_PX = 32;

interface TranscriptAutoScrollTokenParams {
	sessionKey: string | null;
	messages: DisplayMessage[];
	queuedPrompts?: DisplayChatMessage[];
	streamingText: string;
	streamingThinking: string;
	isStreaming: boolean;
	isCompacting?: boolean;
}

interface TranscriptScrollMetrics {
	scrollTop: number;
	clientHeight: number;
	scrollHeight: number;
}

export type TranscriptScrollIntent =
	| "none"
	| "away-from-bottom"
	| "toward-bottom";

export interface TranscriptAutoScrollState {
	stickToBottom: boolean;
	suppressNearBottomStickiness: boolean;
}

export function createTranscriptAutoScrollToken(
	params: TranscriptAutoScrollTokenParams,
): string {
	return [
		params.sessionKey ?? "",
		params.messages.map(displayMessageKey).join("\u0001"),
		params.queuedPrompts?.map(displayMessageKey).join("\u0001") ?? "",
		params.streamingThinking,
		params.streamingText,
		params.isStreaming ? "streaming" : "idle",
		params.isCompacting ? "compacting" : "not-compacting",
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
		String(message.timestamp ?? ""),
		message.images
			?.map((image) =>
				image.kind === "managed"
					? image.path
					: image.kind === "inline"
						? `${image.mediaType}:${image.base64.length}`
						: image.mediaType,
			)
			.join("|") ?? "",
	].join(":");
}

export function displayMessageRenderKey(params: {
	message: DisplayMessage;
	index: number;
	sessionKey: string | null;
}): string {
	return [
		params.sessionKey ?? "",
		params.index,
		displayMessageKey(params.message),
	].join("\u0003");
}

export function isNearTranscriptBottom(
	metrics: TranscriptScrollMetrics,
): boolean {
	return transcriptBottomDistance(metrics) <= BOTTOM_STICKY_TOLERANCE_PX;
}

export function createTranscriptAutoScrollState(): TranscriptAutoScrollState {
	return {
		stickToBottom: true,
		suppressNearBottomStickiness: false,
	};
}

export function resolveTranscriptAutoScrollState(
	state: TranscriptAutoScrollState,
	params: {
		intent: TranscriptScrollIntent;
		metrics: TranscriptScrollMetrics;
	},
): TranscriptAutoScrollState {
	const nearBottom = isNearTranscriptBottom(params.metrics);

	if (params.intent === "away-from-bottom") {
		return {
			stickToBottom: false,
			suppressNearBottomStickiness: nearBottom,
		};
	}

	if (params.intent === "toward-bottom") {
		return {
			stickToBottom: nearBottom,
			suppressNearBottomStickiness: false,
		};
	}

	if (state.suppressNearBottomStickiness && nearBottom) {
		return {
			stickToBottom: false,
			suppressNearBottomStickiness: true,
		};
	}

	return {
		stickToBottom: nearBottom,
		suppressNearBottomStickiness: false,
	};
}

export function shouldShowTranscriptScrollToBottomButton(
	state: TranscriptAutoScrollState,
): boolean {
	return !state.stickToBottom;
}

function transcriptBottomDistance(metrics: TranscriptScrollMetrics): number {
	return metrics.scrollHeight - (metrics.scrollTop + metrics.clientHeight);
}
