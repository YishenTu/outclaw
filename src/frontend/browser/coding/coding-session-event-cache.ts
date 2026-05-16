import type { CodingSessionEventStreamItem } from "../lib/api.ts";

export interface CodingSessionEventCacheEntry {
	events: CodingSessionEventStreamItem[];
	lastSequence: number;
}

export type CodingSessionEventCache = Map<string, CodingSessionEventCacheEntry>;

export const CODING_SESSION_EVENT_CACHE_LIMIT = 25;

export const codingSessionEventCache: CodingSessionEventCache = new Map();
const codingSessionEventListeners = new Map<string, Set<() => void>>();

export function codingSessionEventCacheKey(params: {
	providerId: string;
	sdkSessionId: string;
}): string {
	return `coding:${params.providerId}/${params.sdkSessionId}`;
}

export function readCodingSessionCachedEvents(
	key: string,
): CodingSessionEventStreamItem[] {
	return codingSessionEventCache.get(key)?.events ?? [];
}

export function subscribeCodingSessionCachedEvents(
	key: string,
	listener: () => void,
): () => void {
	let bucket = codingSessionEventListeners.get(key);
	if (!bucket) {
		bucket = new Set();
		codingSessionEventListeners.set(key, bucket);
	}
	bucket.add(listener);
	return () => {
		const current = codingSessionEventListeners.get(key);
		if (!current) {
			return;
		}
		current.delete(listener);
		if (current.size === 0) {
			codingSessionEventListeners.delete(key);
		}
	};
}

export function appendCodingSessionCachedEvent(
	item: CodingSessionEventStreamItem,
): CodingSessionEventCacheEntry {
	const key = codingSessionEventCacheKey(item);
	const currentEvents = readCodingSessionCachedEvents(key);
	const entry = appendCodingSessionEventBatch(
		codingSessionEventCache,
		key,
		currentEvents,
		[item],
	);
	notifyCodingSessionEventListeners(key, currentEvents, entry);
	return entry;
}

export function hydrateCodingSessionCachedEvents(
	key: string,
	events: CodingSessionEventStreamItem[],
): CodingSessionEventCacheEntry {
	const currentEvents = readCodingSessionCachedEvents(key);
	const entry = mergeCodingSessionHydration(
		codingSessionEventCache,
		key,
		currentEvents,
		events,
	);
	notifyCodingSessionEventListeners(key, currentEvents, entry);
	return entry;
}

export function clearCodingSessionEventCache(): void {
	codingSessionEventCache.clear();
	codingSessionEventListeners.clear();
}

export function appendCodingSessionEventBatch(
	cache: CodingSessionEventCache,
	key: string,
	currentEvents: CodingSessionEventStreamItem[],
	pendingEvents: CodingSessionEventStreamItem[],
	options: { allowSequenceRestart?: boolean; maxEntries?: number } = {},
): CodingSessionEventCacheEntry {
	const cached = cache.get(key);
	const firstPendingSequence = pendingEvents[0]?.sequence;
	const currentSequence = currentEvents.at(-1)?.sequence ?? 0;
	const cachedSequence =
		cached?.events === currentEvents ? cached.lastSequence : undefined;
	const currentLastSequence = cachedSequence ?? currentSequence;
	const sequenceRestarted =
		options.allowSequenceRestart === true &&
		firstPendingSequence === 1 &&
		currentLastSequence > 0;
	const baseEvents = sequenceRestarted ? [] : currentEvents;
	let nextEvents = baseEvents;
	let lastSequence = sequenceRestarted ? 0 : currentLastSequence;

	for (const item of pendingEvents) {
		if (item.sequence <= lastSequence) {
			continue;
		}
		lastSequence = item.sequence;
		if (shouldOmitFromCachedTranscript(item.event)) {
			continue;
		}
		nextEvents =
			nextEvents === baseEvents ? [...baseEvents, item] : [...nextEvents, item];
	}

	const entry = {
		events: nextEvents,
		lastSequence: sequenceRestarted
			? lastSequence
			: Math.max(cached?.lastSequence ?? 0, lastSequence),
	};
	rememberCodingSessionEventCacheEntry(cache, key, entry, options.maxEntries);
	return entry;
}

function shouldOmitFromCachedTranscript(event: { type?: string }): boolean {
	return event.type === "usage_updated" || event.type === "image";
}

function rememberCodingSessionEventCacheEntry(
	cache: CodingSessionEventCache,
	key: string,
	entry: CodingSessionEventCacheEntry,
	maxEntries = CODING_SESSION_EVENT_CACHE_LIMIT,
): void {
	if (cache.has(key)) {
		cache.delete(key);
	}
	cache.set(key, entry);
	while (cache.size > maxEntries) {
		const oldestKey = cache.keys().next().value;
		if (oldestKey === undefined) {
			return;
		}
		cache.delete(oldestKey);
	}
}

function mergeCodingSessionHydration(
	cache: CodingSessionEventCache,
	key: string,
	currentEvents: CodingSessionEventStreamItem[],
	hydrationEvents: CodingSessionEventStreamItem[],
): CodingSessionEventCacheEntry {
	const hydrationCache: CodingSessionEventCache = new Map();
	const hydrationEntry = appendCodingSessionEventBatch(
		hydrationCache,
		key,
		[],
		hydrationEvents,
		{ allowSequenceRestart: true, maxEntries: 1 },
	);
	if (currentEvents.length === 0) {
		rememberCodingSessionEventCacheEntry(cache, key, hydrationEntry);
		return hydrationEntry;
	}

	const seen = new Set(
		hydrationEntry.events.map((item) => codingSessionEventItemKey(item)),
	);
	let mergedEvents = hydrationEntry.events;
	for (const item of currentEvents) {
		const itemKey = codingSessionEventItemKey(item);
		if (seen.has(itemKey)) {
			continue;
		}
		seen.add(itemKey);
		mergedEvents =
			mergedEvents === hydrationEntry.events
				? [...hydrationEntry.events, item]
				: [...mergedEvents, item];
	}
	mergedEvents = mergedEvents.toSorted(compareCodingSessionEventItems);

	const cached = cache.get(key);
	const currentLastSequence =
		cached?.events === currentEvents
			? cached.lastSequence
			: (currentEvents.at(-1)?.sequence ?? 0);
	const entry = {
		events: mergedEvents,
		lastSequence: Math.max(hydrationEntry.lastSequence, currentLastSequence),
	};
	rememberCodingSessionEventCacheEntry(cache, key, entry);
	return entry;
}

function compareCodingSessionEventItems(
	left: CodingSessionEventStreamItem,
	right: CodingSessionEventStreamItem,
): number {
	return left.sequence - right.sequence || left.createdAt - right.createdAt;
}

function codingSessionEventItemKey(item: CodingSessionEventStreamItem): string {
	return JSON.stringify(item.event);
}

function notifyCodingSessionEventListeners(
	key: string,
	previousEvents: CodingSessionEventStreamItem[],
	entry: CodingSessionEventCacheEntry,
): void {
	if (entry.events === previousEvents) {
		return;
	}
	for (const listener of [...(codingSessionEventListeners.get(key) ?? [])]) {
		listener();
	}
}
