import type { CodingSessionEvent } from "../../common/protocol.ts";
import { providerSessionRefKey } from "../../common/provider-session-ref.ts";

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
	snapshot?(target: {
		providerId: string;
		sdkSessionId: string;
	}): StoredCodingSessionEvent[];
	subscribe(
		target: { providerId: string; sdkSessionId: string },
		handler: CodingSessionEventSubscriber,
	): () => void;
	subscribeAll?(handler: CodingSessionEventSubscriber): () => void;
}

export const CODING_SESSION_EVENT_REPLAY_LIMIT = 5000;

export class CodingSessionEventHub implements CodingSessionEventRecorder {
	private readonly nextSequenceBySession = new Map<string, number>();
	private readonly eventsBySession = new Map<
		string,
		StoredCodingSessionEvent[]
	>();
	private readonly subscribers = new Map<
		string,
		Set<CodingSessionEventSubscriber>
	>();
	private readonly allSubscribers = new Set<CodingSessionEventSubscriber>();

	constructor(
		private readonly replayLimit = CODING_SESSION_EVENT_REPLAY_LIMIT,
	) {}

	append(params: {
		providerId: string;
		sdkSessionId: string;
		event: CodingSessionEvent;
		timestamp?: number;
	}): StoredCodingSessionEvent {
		const key = providerSessionRefKey(params);
		const sequence = (this.nextSequenceBySession.get(key) ?? 0) + 1;
		this.nextSequenceBySession.set(key, sequence);
		const stored: StoredCodingSessionEvent = {
			providerId: params.providerId,
			sdkSessionId: params.sdkSessionId,
			sequence,
			event: params.event,
			createdAt: params.timestamp ?? Date.now(),
		};
		this.remember(key, stored);
		this.dispatch(stored);
		return stored;
	}

	snapshot(target: {
		providerId: string;
		sdkSessionId: string;
	}): StoredCodingSessionEvent[] {
		return [...(this.eventsBySession.get(providerSessionRefKey(target)) ?? [])];
	}

	subscribe(
		target: { providerId: string; sdkSessionId: string },
		handler: CodingSessionEventSubscriber,
	): () => void {
		const key = providerSessionRefKey(target);
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

	subscribeAll(handler: CodingSessionEventSubscriber): () => void {
		this.allSubscribers.add(handler);
		return () => {
			this.allSubscribers.delete(handler);
		};
	}

	close() {
		this.subscribers.clear();
		this.allSubscribers.clear();
		this.nextSequenceBySession.clear();
		this.eventsBySession.clear();
	}

	private remember(key: string, stored: StoredCodingSessionEvent) {
		if (this.replayLimit <= 0) {
			return;
		}
		const events = this.eventsBySession.get(key) ?? [];
		events.push(stored);
		while (events.length > this.replayLimit) {
			events.shift();
		}
		this.eventsBySession.set(key, events);
	}

	private dispatch(stored: StoredCodingSessionEvent) {
		for (const handler of [...this.allSubscribers]) {
			handler(stored);
		}
		const bucket = this.subscribers.get(providerSessionRefKey(stored));
		if (!bucket || bucket.size === 0) {
			return;
		}
		for (const handler of [...bucket]) {
			handler(stored);
		}
	}
}
