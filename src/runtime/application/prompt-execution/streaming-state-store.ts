import {
	appendAssistantStreamEvent,
	cloneAssistantMessageSegments,
} from "../../../common/assistant-message-segments.ts";
import type {
	AssistantMessageSegment,
	DisplayImage,
	FacadeEvent,
} from "../../../common/protocol.ts";
import {
	appendThinkingBlockDelta,
	createThinkingBlockState,
	snapshotThinkingBlockState,
	type ThinkingBlockState,
} from "../../../common/thinking-blocks.ts";

export interface StreamingStateSnapshot {
	images: DisplayImage[];
	text: string;
	thinking: string;
	thinkingBlocks: string[];
	thinkingBlockId?: string;
	segments: AssistantMessageSegment[];
}

interface MutableStreamingStateSnapshot {
	images: DisplayImage[];
	text: string;
	thinking: ThinkingBlockState;
	segments: AssistantMessageSegment[];
}

export class StreamingStateStore {
	private readonly snapshots = new Map<string, MutableStreamingStateSnapshot>();

	start(providerId: string, sessionId: string) {
		this.snapshots.set(streamingKey(providerId, sessionId), {
			images: [],
			text: "",
			thinking: createThinkingBlockState(),
			segments: [],
		});
	}

	recordEvent(providerId: string, sessionId: string, event: FacadeEvent) {
		const snapshot = this.snapshots.get(streamingKey(providerId, sessionId));
		if (!snapshot) {
			return;
		}

		if (event.type === "text") {
			snapshot.text += event.text;
			snapshot.segments = appendAssistantStreamEvent(snapshot.segments, event);
			return;
		}

		if (event.type === "thinking") {
			snapshot.thinking = appendThinkingBlockDelta(snapshot.thinking, event);
			snapshot.segments = appendAssistantStreamEvent(snapshot.segments, event);
			return;
		}

		if (event.type === "image") {
			snapshot.images.push({
				kind: "managed",
				path: event.path,
				mediaType: event.mediaType ?? "image/png",
			});
		}
	}

	get(
		providerId: string,
		sessionId: string,
	): StreamingStateSnapshot | undefined {
		const snapshot = this.snapshots.get(streamingKey(providerId, sessionId));
		if (!snapshot) {
			return undefined;
		}
		const thinking = snapshotThinkingBlockState(snapshot.thinking);

		return {
			images: [...snapshot.images],
			text: snapshot.text,
			thinking: thinking.text,
			thinkingBlocks: thinking.blocks,
			segments: cloneAssistantMessageSegments(snapshot.segments),
			...(thinking.currentBlockId !== undefined
				? { thinkingBlockId: thinking.currentBlockId }
				: {}),
		};
	}

	clear(providerId: string, sessionId: string) {
		this.snapshots.delete(streamingKey(providerId, sessionId));
	}
}

function streamingKey(providerId: string, sessionId: string): string {
	return `${providerId}\0${sessionId}`;
}
