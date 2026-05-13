import type { CodingSessionEvent } from "../../common/protocol.ts";
import type {
	CodingSessionEventRecorder,
	StoredCodingSessionEvent,
} from "./coding-session-event-hub.ts";

export interface CodingSessionEventHistory {
	readCodingSessionEvents(params: {
		providerId: string;
		sdkSessionId: string;
	}): Promise<CodingSessionEvent[]>;
}

export interface CodingSessionExistence {
	hasCodingSession(params: {
		providerId: string;
		sdkSessionId: string;
	}): boolean;
}

export interface OpenCodingSessionEventStreamParams {
	history?: CodingSessionEventHistory;
	liveEvents?: CodingSessionEventRecorder;
	sessions?: CodingSessionExistence;
	providerId: string;
	sdkSessionId: string;
	sinceSequence?: number;
	signal?: AbortSignal;
}

export async function* openCodingSessionEventStream(
	params: OpenCodingSessionEventStreamParams,
): AsyncIterable<StoredCodingSessionEvent> {
	const signal = params.signal;
	if (signal?.aborted) {
		return;
	}

	const liveBuffer: StoredCodingSessionEvent[] = [];
	let notify: () => void = () => {};
	let waiter = new Promise<void>((resolve) => {
		notify = resolve;
	});
	const onAbort = () => notify();
	signal?.addEventListener("abort", onAbort, { once: true });
	const unsubscribe = params.liveEvents?.subscribe(
		{
			providerId: params.providerId,
			sdkSessionId: params.sdkSessionId,
		},
		(stored) => {
			liveBuffer.push(stored);
			notify();
		},
	);

	try {
		const history = await readCodingSessionHistory(params);
		let overlappingBufferedEvents = countHistoryLiveEventOverlap(
			history,
			liveBuffer.map((live) => live.event),
		);
		const sinceSequence = params.sinceSequence ?? 0;
		let nextSequence = 1;
		const historyCreatedAt = Date.now();
		for (const event of history) {
			const stored = toStoredCodingSessionEvent({
				providerId: params.providerId,
				sdkSessionId: params.sdkSessionId,
				sequence: nextSequence,
				event,
				createdAt: historyCreatedAt + nextSequence - 1,
			});
			nextSequence += 1;
			if (stored.sequence > sinceSequence) {
				yield stored;
			}
		}

		if (nextSequence <= sinceSequence) {
			nextSequence = sinceSequence + 1;
		}

		while (!signal?.aborted && params.liveEvents) {
			while (liveBuffer.length > 0) {
				const live = liveBuffer.shift();
				if (!live) {
					continue;
				}
				if (overlappingBufferedEvents > 0) {
					overlappingBufferedEvents -= 1;
					continue;
				}
				yield toStoredCodingSessionEvent({
					providerId: params.providerId,
					sdkSessionId: params.sdkSessionId,
					sequence: nextSequence,
					event: live.event,
					createdAt: live.createdAt,
				});
				nextSequence += 1;
			}
			if (signal?.aborted) {
				return;
			}
			await waiter;
			waiter = new Promise<void>((resolve) => {
				notify = resolve;
			});
		}
	} finally {
		unsubscribe?.();
		signal?.removeEventListener("abort", onAbort);
	}
}

async function readCodingSessionHistory(params: {
	history?: CodingSessionEventHistory;
	sessions?: CodingSessionExistence;
	providerId: string;
	sdkSessionId: string;
	signal?: AbortSignal;
}): Promise<CodingSessionEvent[]> {
	if (
		params.signal?.aborted ||
		!params.history ||
		(params.sessions &&
			!params.sessions.hasCodingSession({
				providerId: params.providerId,
				sdkSessionId: params.sdkSessionId,
			}))
	) {
		return [];
	}
	return params.history.readCodingSessionEvents({
		providerId: params.providerId,
		sdkSessionId: params.sdkSessionId,
	});
}

function toStoredCodingSessionEvent(params: {
	providerId: string;
	sdkSessionId: string;
	sequence: number;
	event: CodingSessionEvent;
	createdAt: number;
}): StoredCodingSessionEvent {
	return {
		providerId: params.providerId,
		sdkSessionId: params.sdkSessionId,
		sequence: params.sequence,
		event: params.event,
		createdAt: params.createdAt,
	};
}

function countHistoryLiveEventOverlap(
	history: CodingSessionEvent[],
	bufferedLiveEvents: CodingSessionEvent[],
): number {
	const maxOverlap = Math.min(history.length, bufferedLiveEvents.length);
	for (let count = maxOverlap; count > 0; count -= 1) {
		let matches = true;
		for (let index = 0; index < count; index += 1) {
			const historyEvent = history[history.length - count + index];
			const liveEvent = bufferedLiveEvents[index];
			if (
				!historyEvent ||
				!liveEvent ||
				codingSessionEventKey(historyEvent) !== codingSessionEventKey(liveEvent)
			) {
				matches = false;
				break;
			}
		}
		if (matches) {
			return count;
		}
	}
	return 0;
}

function codingSessionEventKey(event: CodingSessionEvent): string {
	return JSON.stringify(event);
}
