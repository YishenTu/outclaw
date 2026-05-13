import type { CodingSessionEventStreamItem } from "../lib/api.ts";

export interface CodingSessionEventCacheEntry {
	events: CodingSessionEventStreamItem[];
	lastSequence: number;
}

export type CodingSessionEventCache = Map<string, CodingSessionEventCacheEntry>;

export const CODING_SESSION_EVENT_CACHE_LIMIT = 25;

export const codingSessionEventCache: CodingSessionEventCache = new Map();

export function appendCodingSessionEventBatch(
	cache: CodingSessionEventCache,
	key: string,
	currentEvents: CodingSessionEventStreamItem[],
	pendingEvents: CodingSessionEventStreamItem[],
	options: { allowSequenceRestart?: boolean; maxEntries?: number } = {},
): CodingSessionEventCacheEntry {
	const cached = cache.get(key);
	const firstPendingSequence = pendingEvents[0]?.sequence;
	const currentLastSequence =
		cached?.lastSequence ?? currentEvents.at(-1)?.sequence ?? 0;
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
		if (isTranscriptSilentCodingEvent(item.event)) {
			continue;
		}
		nextEvents =
			nextEvents === baseEvents ? [...baseEvents, item] : [...nextEvents, item];
	}

	const entry = { events: nextEvents, lastSequence };
	rememberCodingSessionEventCacheEntry(cache, key, entry, options.maxEntries);
	return entry;
}

export function isTranscriptSilentCodingEvent(event: unknown): boolean {
	if (!event || typeof event !== "object") {
		return false;
	}
	const record = event as { toolKind?: unknown; type?: unknown };
	const type = record.type;
	if (type === "usage_updated" || type === "image") {
		return true;
	}
	if (type !== "tool_call_started" && type !== "tool_call_completed") {
		return false;
	}
	return (
		record.toolKind === "write_stdin" ||
		record.toolKind === "custom_tool_call_output"
	);
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
