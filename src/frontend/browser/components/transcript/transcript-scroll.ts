import {
	type TranscriptItem,
	transcriptItemScrollKey,
} from "./transcript-items.ts";

const BOTTOM_STICKY_TOLERANCE_PX = 32;

interface TranscriptAutoScrollTokenParams {
	sessionKey: string | null;
	items: TranscriptItem[];
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
		params.items.map(transcriptItemScrollKey).join("\u0001"),
	].join("\u0002");
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
