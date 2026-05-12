import type { CodingSessionEvent } from "../../common/protocol.ts";

export interface StoredCodingSessionEvent {
	providerId: string;
	sdkSessionId: string;
	sequence: number;
	event: CodingSessionEvent;
	createdAt: number;
}

export type CodingSessionEventSubscriber = (
	event: StoredCodingSessionEvent,
) => void;

export interface CodingSessionEventRecorder {
	append(params: {
		providerId: string;
		sdkSessionId: string;
		event: CodingSessionEvent;
		timestamp?: number;
	}): StoredCodingSessionEvent;
	subscribe(
		target: { providerId: string; sdkSessionId: string },
		handler: CodingSessionEventSubscriber,
	): () => void;
}

export class CodingSessionEventHub implements CodingSessionEventRecorder {
	private readonly nextSequenceBySession = new Map<string, number>();
	private readonly subscribers = new Map<
		string,
		Set<CodingSessionEventSubscriber>
	>();

	append(params: {
		providerId: string;
		sdkSessionId: string;
		event: CodingSessionEvent;
		timestamp?: number;
	}): StoredCodingSessionEvent {
		const key = subscriberKey(params.providerId, params.sdkSessionId);
		const sequence = (this.nextSequenceBySession.get(key) ?? 0) + 1;
		this.nextSequenceBySession.set(key, sequence);
		const stored: StoredCodingSessionEvent = {
			providerId: params.providerId,
			sdkSessionId: params.sdkSessionId,
			sequence,
			event: params.event,
			createdAt: params.timestamp ?? Date.now(),
		};
		this.dispatch(stored);
		return stored;
	}

	subscribe(
		target: { providerId: string; sdkSessionId: string },
		handler: CodingSessionEventSubscriber,
	): () => void {
		const key = subscriberKey(target.providerId, target.sdkSessionId);
		let bucket = this.subscribers.get(key);
		if (!bucket) {
			bucket = new Set();
			this.subscribers.set(key, bucket);
		}
		bucket.add(handler);
		return () => {
			const current = this.subscribers.get(key);
			if (!current) {
				return;
			}
			current.delete(handler);
			if (current.size === 0) {
				this.subscribers.delete(key);
			}
		};
	}

	close() {
		this.subscribers.clear();
		this.nextSequenceBySession.clear();
	}

	private dispatch(stored: StoredCodingSessionEvent) {
		const bucket = this.subscribers.get(
			subscriberKey(stored.providerId, stored.sdkSessionId),
		);
		if (!bucket || bucket.size === 0) {
			return;
		}
		for (const handler of [...bucket]) {
			handler(stored);
		}
	}
}

function subscriberKey(providerId: string, sdkSessionId: string): string {
	return `${providerId}\u0000${sdkSessionId}`;
}
