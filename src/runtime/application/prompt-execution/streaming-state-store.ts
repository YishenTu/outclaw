import type { DisplayImage, FacadeEvent } from "../../../common/protocol.ts";
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
}

interface MutableStreamingStateSnapshot {
	images: DisplayImage[];
	text: string;
	thinking: ThinkingBlockState;
}

export class StreamingStateStore {
	private readonly snapshots = new Map<string, MutableStreamingStateSnapshot>();

	start(providerId: string, sessionId: string) {
		this.snapshots.set(streamingKey(providerId, sessionId), {
			images: [],
			text: "",
			thinking: createThinkingBlockState(),
		});
	}

	recordEvent(providerId: string, sessionId: string, event: FacadeEvent) {
		const snapshot = this.snapshots.get(streamingKey(providerId, sessionId));
		if (!snapshot) {
			return;
		}

		if (event.type === "text") {
			snapshot.text += event.text;
			return;
		}

		if (event.type === "thinking") {
			snapshot.thinking = appendThinkingBlockDelta(snapshot.thinking, event);
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
