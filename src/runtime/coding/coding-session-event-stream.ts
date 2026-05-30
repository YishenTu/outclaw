import {
	codingSessionEventKey,
	codingSessionEventsSettleLatestTurn,
	countCodingSessionHistorySuffixCoveredByLive,
	countCodingSessionLivePrefixCoveredByHistory,
} from "../../common/coding-session-event-merge.ts";
import type { CodingSessionEvent } from "../../common/protocol.ts";
import { formatProviderSessionRef } from "../../common/provider-session-ref.ts";
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
	follow?: boolean;
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
	const liveSnapshot =
		params.liveEvents?.snapshot?.({
			providerId: params.providerId,
			sdkSessionId: params.sdkSessionId,
		}) ?? [];

	try {
		const history = await readCodingSessionHistory(params);
		const seedEvents = mergeHistoryAndLiveSnapshot(history, liveSnapshot);
		let overlappingBufferedEvents = countHistoryLiveEventOverlap(
			seedEvents.map((seed) => seed.event),
			liveBuffer.map((live) => live.event),
		);
		const sinceSequence = params.sinceSequence ?? 0;
		let nextSequence = 1;
		const historyCreatedAt = Date.now();
		for (const seed of seedEvents) {
			const stored = toStoredCodingSessionEvent({
				providerId: params.providerId,
				sdkSessionId: params.sdkSessionId,
				sequence: nextSequence,
				event: seed.event,
				createdAt:
					seed.createdAt ??
					readCodingSessionEventTimestamp(seed.event) ??
					historyCreatedAt + nextSequence - 1,
			});
			nextSequence += 1;
			if (stored.sequence > sinceSequence) {
				yield stored;
			}
		}

		if (nextSequence <= sinceSequence) {
			nextSequence = sinceSequence + 1;
		}

		while (!signal?.aborted && params.liveEvents && params.follow !== false) {
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
	if (params.signal?.aborted || !params.history) {
		return [];
	}
	if (
		params.sessions &&
		!params.sessions.hasCodingSession({
			providerId: params.providerId,
			sdkSessionId: params.sdkSessionId,
		})
	) {
		throw new Error(
			`Unknown coding session: ${formatProviderSessionRef(params)}`,
		);
	}
	return params.history.readCodingSessionEvents({
		providerId: params.providerId,
		sdkSessionId: params.sdkSessionId,
	});
}

interface CodingSessionEventSeed {
	event: CodingSessionEvent;
	createdAt?: number;
}

function mergeHistoryAndLiveSnapshot(
	history: CodingSessionEvent[],
	liveSnapshot: StoredCodingSessionEvent[],
): CodingSessionEventSeed[] {
	if (liveSnapshot.length === 0) {
		return history.map((event) => ({ event }));
	}
	const snapshotEvents = liveSnapshot.map((stored) => stored.event);
	const historySuffixCoveredByLive =
		countCodingSessionHistorySuffixCoveredByLive(history, snapshotEvents);
	if (
		codingSessionEventsSettleLatestTurn(snapshotEvents) &&
		(history.length === 0 || historySuffixCoveredByLive > 0)
	) {
		return [
			...history
				.slice(0, history.length - historySuffixCoveredByLive)
				.map((event) => ({ event })),
			...liveSnapshot.map((stored) => ({
				event: stored.event,
				createdAt: stored.createdAt,
			})),
		];
	}

	const livePrefixCoveredByHistory =
		countCodingSessionLivePrefixCoveredByHistory(history, snapshotEvents);
	if (livePrefixCoveredByHistory >= liveSnapshot.length) {
		return history.map((event) => ({ event }));
	}
	if (livePrefixCoveredByHistory > 0) {
		return [
			...history.map((event) => ({ event })),
			...liveSnapshot.slice(livePrefixCoveredByHistory).map((stored) => ({
				event: stored.event,
				createdAt: stored.createdAt,
			})),
		];
	}

	return [
		...history
			.slice(0, history.length - historySuffixCoveredByLive)
			.map((event) => ({ event })),
		...liveSnapshot.map((stored) => ({
			event: stored.event,
			createdAt: stored.createdAt,
		})),
	];
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

function readCodingSessionEventTimestamp(
	event: CodingSessionEvent,
): number | undefined {
	const timestamp = "timestamp" in event ? event.timestamp : undefined;
	return typeof timestamp === "number" && Number.isFinite(timestamp)
		? timestamp
		: undefined;
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
