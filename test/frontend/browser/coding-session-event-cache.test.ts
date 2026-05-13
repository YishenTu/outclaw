import { describe, expect, test } from "bun:test";
import {
	appendCodingSessionEventBatch,
	type CodingSessionEventCache,
} from "../../../src/frontend/browser/coding/coding-session-event-cache.ts";
import type { CodingSessionEventStreamItem } from "../../../src/frontend/browser/lib/api.ts";

function streamItem(
	sequence: number,
	event: Record<string, unknown>,
): CodingSessionEventStreamItem {
	return {
		providerId: "codex",
		sdkSessionId: "session-1",
		sequence,
		event,
		createdAt: sequence,
	};
}

describe("coding session event cache", () => {
	test("drops transcript-silent events while advancing the replay cursor", () => {
		const cache: CodingSessionEventCache = new Map();
		const entry = appendCodingSessionEventBatch(
			cache,
			"coding:session-1",
			[],
			[
				streamItem(1, { type: "user_prompt", text: "go" }),
				streamItem(2, { type: "usage_updated", usage: {} }),
				streamItem(3, {
					type: "tool_call_completed",
					toolKind: "write_stdin",
					details: [{ label: "output", value: "poll" }],
				}),
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
});
