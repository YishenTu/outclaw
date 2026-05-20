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
				createdAt: seed.createdAt ?? historyCreatedAt + nextSequence - 1,
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
			`Unknown coding session: ${params.providerId}/${params.sdkSessionId}`,
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
	if (isCompleteFreshLiveSnapshot(liveSnapshot)) {
		return liveSnapshot.map((stored) => ({
			event: stored.event,
			createdAt: stored.createdAt,
		}));
	}
	const snapshotEvents = liveSnapshot.map((stored) => stored.event);
	const overlap = findHistorySuffixInLiveSnapshot(history, snapshotEvents);
	return [
		...history
			.slice(0, history.length - overlap.length)
			.map((event) => ({ event })),
		...liveSnapshot.map((stored) => ({
			event: stored.event,
			createdAt: stored.createdAt,
		})),
	];
}

function isCompleteFreshLiveSnapshot(
	liveSnapshot: StoredCodingSessionEvent[],
): boolean {
	const first = liveSnapshot[0];
	return first?.sequence === 1 && first.event.type === "session_initialized";
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

function findHistorySuffixInLiveSnapshot(
	history: CodingSessionEvent[],
	liveSnapshot: CodingSessionEvent[],
): { length: number } {
	const semanticOverlap = findSemanticHistorySuffixInLiveSnapshot(
		history,
		liveSnapshot,
	);
	if (semanticOverlap.length > 0) {
		return semanticOverlap;
	}

	const maxLength = Math.min(history.length, liveSnapshot.length);
	for (let length = maxLength; length > 0; length -= 1) {
		const historyStart = history.length - length;
		for (
			let snapshotStart = 0;
			snapshotStart <= liveSnapshot.length - length;
			snapshotStart += 1
		) {
			let matches = true;
			for (let offset = 0; offset < length; offset += 1) {
				const historyEvent = history[historyStart + offset];
				const liveEvent = liveSnapshot[snapshotStart + offset];
				if (
					!historyEvent ||
					!liveEvent ||
					codingSessionEventKey(historyEvent) !==
						codingSessionEventKey(liveEvent)
				) {
					matches = false;
					break;
				}
			}
			if (matches) {
				return { length };
			}
		}
	}
	return { length: 0 };
}

type CodingEventSignaturePart =
	| { type: "event"; key: string }
	| { type: "text"; text: string }
	| { type: "thinking"; text: string };

function findSemanticHistorySuffixInLiveSnapshot(
	history: CodingSessionEvent[],
	liveSnapshot: CodingSessionEvent[],
): { length: number } {
	for (let historyStart = 0; historyStart < history.length; historyStart += 1) {
		if (history[historyStart]?.type !== "user_prompt") {
			continue;
		}
		const historySignature = buildCodingEventSignature(
			history.slice(historyStart),
		);
		for (
			let snapshotStart = 0;
			snapshotStart < liveSnapshot.length;
			snapshotStart += 1
		) {
			if (liveSnapshot[snapshotStart]?.type !== "user_prompt") {
				continue;
			}
			const liveSignature = buildCodingEventSignature(
				liveSnapshot.slice(snapshotStart),
			);
			if (codingEventSignatureCoveredByLive(historySignature, liveSignature)) {
				return { length: history.length - historyStart };
			}
		}
	}

	return { length: 0 };
}

function buildCodingEventSignature(
	events: CodingSessionEvent[],
): CodingEventSignaturePart[] {
	const signature: CodingEventSignaturePart[] = [];
	let text = "";
	let thinking = "";
	let thinkingBlockId: string | undefined;

	const flushText = () => {
		if (text !== "") {
			signature.push({ type: "text", text });
			text = "";
		}
	};
	const flushThinking = () => {
		if (thinking !== "") {
			signature.push({ type: "thinking", text: thinking });
			thinking = "";
			thinkingBlockId = undefined;
		}
	};

	for (const event of events) {
		if (event.type === "text") {
			flushThinking();
			text += event.text;
			continue;
		}
		if (event.type === "thinking") {
			flushText();
			const blockId = event.blockId;
			if (thinking !== "" && thinkingBlockId !== blockId) {
				flushThinking();
			}
			thinkingBlockId = blockId;
			thinking += event.text;
			continue;
		}

		flushText();
		flushThinking();
		signature.push({ type: "event", key: codingSessionEventKey(event) });
	}

	flushText();
	flushThinking();
	return signature;
}

function codingEventSignatureCoveredByLive(
	history: CodingEventSignaturePart[],
	live: CodingEventSignaturePart[],
): boolean {
	if (history.length === 0 || live.length < history.length) {
		return false;
	}

	return history.every((part, index) => {
		const livePart = live[index];
		if (!livePart || livePart.type !== part.type) {
			return false;
		}
		if (part.type === "event") {
			return livePart.type === "event" && livePart.key === part.key;
		}
		return livePart.type === part.type && livePart.text.startsWith(part.text);
	});
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
	if (event.type === "user_prompt") {
		return JSON.stringify({
			type: event.type,
			text: event.text,
			...(event.images ? { images: event.images } : {}),
		});
	}
	if (event.type === "done") {
		return JSON.stringify({ type: event.type });
	}
	if (event.type === "turn_aborted") {
		return JSON.stringify({ type: event.type });
	}

	return JSON.stringify(stableCodingSessionEventRecord(event));
}

function stableCodingSessionEventRecord(
	event: CodingSessionEvent,
): Record<string, unknown> {
	const record = { ...event } as Record<string, unknown>;
	delete record.durationMs;
	delete record.sessionId;
	delete record.timestamp;
	delete record.usage;
	delete record.blockId;
	return record;
}
