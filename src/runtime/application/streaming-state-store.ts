import type { DisplayImage, FacadeEvent } from "../../common/protocol.ts";

export interface StreamingStateSnapshot {
	images: DisplayImage[];
	text: string;
	thinking: string;
}

export class StreamingStateStore {
	private readonly snapshots = new Map<string, StreamingStateSnapshot>();

	start(sessionId: string) {
		this.snapshots.set(sessionId, {
			images: [],
			text: "",
			thinking: "",
		});
	}

	recordEvent(sessionId: string, event: FacadeEvent) {
		const snapshot = this.snapshots.get(sessionId);
		if (!snapshot) {
			return;
		}

		if (event.type === "text") {
			snapshot.text += event.text;
			return;
		}

		if (event.type === "thinking") {
			snapshot.thinking += event.text;
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

	get(sessionId: string): StreamingStateSnapshot | undefined {
		const snapshot = this.snapshots.get(sessionId);
		if (!snapshot) {
			return undefined;
		}

		return {
			images: [...snapshot.images],
			text: snapshot.text,
			thinking: snapshot.thinking,
		};
	}

	clear(sessionId: string) {
		this.snapshots.delete(sessionId);
	}
}
