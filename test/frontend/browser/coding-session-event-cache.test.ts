import { afterEach, describe, expect, test } from "bun:test";
import type { CodingSessionEvent } from "../../../src/common/protocol.ts";
import {
	appendCodingSessionCachedEvent,
	appendCodingSessionEventBatch,
	type CodingSessionEventCache,
	clearCodingSessionEventCache,
	codingSessionEventCacheKey,
	hydrateCodingSessionCachedEvents,
	readCodingSessionCachedEvents,
	subscribeCodingSessionCachedEvents,
} from "../../../src/frontend/browser/coding/coding-session-event-cache.ts";
import type { CodingSessionEventStreamItem } from "../../../src/frontend/browser/lib/api.ts";

function streamItem(
	sequence: number,
	event: unknown,
): CodingSessionEventStreamItem {
	return {
		providerId: "codex",
		sdkSessionId: "session-1",
		sequence,
		event: event as CodingSessionEvent,
		createdAt: sequence,
	};
}

describe("coding session event cache", () => {
	afterEach(() => {
		clearCodingSessionEventCache();
	});

	test("notifies subscribers when websocket coding events update a session", () => {
		const key = codingSessionEventCacheKey({
			providerId: "codex",
			sdkSessionId: "session-1",
		});
		let notifications = 0;
		const unsubscribe = subscribeCodingSessionCachedEvents(key, () => {
			notifications += 1;
		});

		appendCodingSessionCachedEvent(
			streamItem(1, { type: "user_prompt", text: "go" }),
		);
		appendCodingSessionCachedEvent(streamItem(2, { type: "text", text: "hi" }));

		expect(
			readCodingSessionCachedEvents(key).map((item) => item.event),
		).toEqual([
			{ type: "user_prompt", text: "go" },
			{ type: "text", text: "hi" },
		]);
		expect(notifications).toBe(2);

		unsubscribe();
	});

	test("hydrates an old session from provider history without a live stream", () => {
		const key = codingSessionEventCacheKey({
			providerId: "codex",
			sdkSessionId: "session-1",
		});

		hydrateCodingSessionCachedEvents(key, [
			streamItem(1, { type: "user_prompt", text: "show history" }),
			streamItem(2, { type: "text", text: "loaded" }),
		]);

		expect(
			readCodingSessionCachedEvents(key).map((item) => item.event),
		).toEqual([
			{ type: "user_prompt", text: "show history" },
			{ type: "text", text: "loaded" },
		]);
	});

	test("backfills provider history before a later websocket event already in cache", () => {
		const key = codingSessionEventCacheKey({
			providerId: "codex",
			sdkSessionId: "session-1",
		});

		appendCodingSessionCachedEvent(
			streamItem(4, { type: "text", text: "live" }),
		);

		hydrateCodingSessionCachedEvents(key, [
			streamItem(1, { type: "user_prompt", text: "go" }),
			streamItem(2, { type: "text", text: "hel" }),
			streamItem(3, { type: "text", text: "lo" }),
		]);

		expect(
			readCodingSessionCachedEvents(key).map((item) => item.event),
		).toEqual([
			{ type: "user_prompt", text: "go" },
			{ type: "text", text: "hel" },
			{ type: "text", text: "lo" },
			{ type: "text", text: "live" },
		]);
	});

	test("deduplicates websocket events already present in provider hydration", () => {
		const key = codingSessionEventCacheKey({
			providerId: "codex",
			sdkSessionId: "session-1",
		});

		appendCodingSessionCachedEvent(streamItem(3, { type: "text", text: "lo" }));

		hydrateCodingSessionCachedEvents(key, [
			streamItem(1, { type: "user_prompt", text: "go" }),
			streamItem(2, { type: "text", text: "hel" }),
			streamItem(3, { type: "text", text: "lo" }),
		]);

		expect(
			readCodingSessionCachedEvents(key).map((item) => item.event),
		).toEqual([
			{ type: "user_prompt", text: "go" },
			{ type: "text", text: "hel" },
			{ type: "text", text: "lo" },
		]);
	});

	test("drops provider-neutral non-transcript events while advancing the replay cursor", () => {
		const cache: CodingSessionEventCache = new Map();
		const entry = appendCodingSessionEventBatch(
			cache,
			"coding:session-1",
			[],
			[
				streamItem(1, { type: "user_prompt", text: "go" }),
				streamItem(2, { type: "usage_updated", usage: {} }),
				streamItem(3, { type: "image", path: "/tmp/out.png" }),
				streamItem(4, { type: "text", text: "done" }),
			],
		);

		expect(entry.lastSequence).toBe(4);
		expect(entry.events.map((item) => item.sequence)).toEqual([1, 4]);
		expect(cache.get("coding:session-1")?.lastSequence).toBe(4);
	});

	test("evicts least recently used entries when the cache limit is reached", () => {
		const cache: CodingSessionEventCache = new Map();
		appendCodingSessionEventBatch(
			cache,
			"coding:a",
			[],
			[streamItem(1, { type: "text", text: "a" })],
			{ maxEntries: 2 },
		);
		appendCodingSessionEventBatch(
			cache,
			"coding:b",
			[],
			[streamItem(1, { type: "text", text: "b" })],
			{ maxEntries: 2 },
		);
		appendCodingSessionEventBatch(
			cache,
			"coding:a",
			cache.get("coding:a")?.events ?? [],
			[streamItem(2, { type: "text", text: "a2" })],
			{ maxEntries: 2 },
		);
		appendCodingSessionEventBatch(
			cache,
			"coding:c",
			[],
			[streamItem(1, { type: "text", text: "c" })],
			{ maxEntries: 2 },
		);

		expect([...cache.keys()]).toEqual(["coding:a", "coding:c"]);
	});

	test("rebuilds cached events when a new subscription replays from sequence one", () => {
		const cache: CodingSessionEventCache = new Map([
			[
				"coding:session-1",
				{
					events: [streamItem(4, { type: "text", text: "stale" })],
					lastSequence: 4,
				},
			],
		]);

		const entry = appendCodingSessionEventBatch(
			cache,
			"coding:session-1",
			cache.get("coding:session-1")?.events ?? [],
			[
				streamItem(1, { type: "user_prompt", text: "show history" }),
				streamItem(2, { type: "text", text: "loaded" }),
			],
			{ allowSequenceRestart: true },
		);

		expect(entry.lastSequence).toBe(2);
		expect(entry.events.map((item) => item.sequence)).toEqual([1, 2]);
		expect(entry.events.map((item) => item.event)).toEqual([
			{ type: "user_prompt", text: "show history" },
			{ type: "text", text: "loaded" },
		]);
	});

	test("does not drop a visible batch when React replays a stale state updater", () => {
		const cache: CodingSessionEventCache = new Map();
		const staleCurrentEvents: CodingSessionEventStreamItem[] = [];
		const pending = [
			streamItem(1, { type: "text", text: "hel" }),
			streamItem(2, { type: "text", text: "lo" }),
		];

		const first = appendCodingSessionEventBatch(
			cache,
			"coding:session-1",
			staleCurrentEvents,
			pending,
		);
		const replayed = appendCodingSessionEventBatch(
			cache,
			"coding:session-1",
			staleCurrentEvents,
			pending,
		);

		expect(first.events.map((item) => item.event)).toEqual([
			{ type: "text", text: "hel" },
			{ type: "text", text: "lo" },
		]);
		expect(replayed.events.map((item) => item.event)).toEqual([
			{ type: "text", text: "hel" },
			{ type: "text", text: "lo" },
		]);
		expect(cache.get("coding:session-1")?.events).toEqual(replayed.events);
	});
});
