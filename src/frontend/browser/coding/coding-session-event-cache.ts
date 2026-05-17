import type { CodingSessionEventStreamItem } from "../lib/api.ts";

export interface CodingSessionEventCacheEntry {
	events: CodingSessionEventStreamItem[];
	lastSequence: number;
	lastLiveSequence?: number;
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
	const cached = codingSessionEventCache.get(key);
	const currentEvents = readCodingSessionCachedEvents(key);
	const entry = appendCodingSessionEventBatch(
		codingSessionEventCache,
		key,
		currentEvents,
		[item],
		{
			liveSource: true,
			sequenceCursor:
				cached?.events === currentEvents ? (cached.lastLiveSequence ?? 0) : 0,
		},
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
	options: {
		allowSequenceRestart?: boolean;
		liveSource?: boolean;
		maxEntries?: number;
		sequenceCursor?: number;
	} = {},
): CodingSessionEventCacheEntry {
	const cached = cache.get(key);
	const firstPendingSequence = pendingEvents[0]?.sequence;
	const currentSequence = currentEvents.at(-1)?.sequence ?? 0;
	const cachedSequence =
		cached?.events === currentEvents ? cached.lastSequence : undefined;
	const currentLastSequence =
		options.sequenceCursor ?? cachedSequence ?? currentSequence;
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
			: Math.max(cached?.lastSequence ?? 0, currentSequence, lastSequence),
		...resolveLastLiveSequence(cached, lastSequence, options.liveSource),
	};
	rememberCodingSessionEventCacheEntry(cache, key, entry, options.maxEntries);
	return entry;
}

function resolveLastLiveSequence(
	cached: CodingSessionEventCacheEntry | undefined,
	lastSequence: number,
	liveSource: boolean | undefined,
): Pick<CodingSessionEventCacheEntry, "lastLiveSequence"> {
	if (liveSource) {
		return {
			lastLiveSequence: Math.max(cached?.lastLiveSequence ?? 0, lastSequence),
		};
	}
	return cached?.lastLiveSequence === undefined
		? {}
		: { lastLiveSequence: cached.lastLiveSequence };
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
		const entry = {
			...hydrationEntry,
			...resolveLastLiveSequence(cache.get(key), 0, false),
		};
		rememberCodingSessionEventCacheEntry(cache, key, entry);
		return entry;
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
	const cached = cache.get(key);
	const currentLastSequence =
		cached?.events === currentEvents
			? cached.lastSequence
			: (currentEvents.at(-1)?.sequence ?? 0);
	const entry = {
		events: mergedEvents,
		lastSequence: Math.max(hydrationEntry.lastSequence, currentLastSequence),
		...resolveLastLiveSequence(cached, 0, false),
	};
	rememberCodingSessionEventCacheEntry(cache, key, entry);
	return entry;
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
