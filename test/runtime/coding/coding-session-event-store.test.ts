import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CODING_STORAGE_OWNER_ID,
	CodingSessionEventStore,
	CodingSessionStore,
	replayThenFollowCodingSessionEvents,
	type StoredCodingSessionEvent,
} from "../../../src/runtime/coding/index.ts";
import { SessionStore } from "../../../src/runtime/persistence/session-store/session-store.ts";

function createStores(storageOwnerId = CODING_STORAGE_OWNER_ID) {
	const dbPath = join(
		mkdtempSync(join(tmpdir(), "outclaw-coding-events-")),
		"sessions.sqlite",
	);
	const sessions = new SessionStore(dbPath, {
		agentId: storageOwnerId,
		journalMode: "DELETE",
	});
	const codingSessions = new CodingSessionStore(dbPath, {
		journalMode: "DELETE",
		storageOwnerId,
	});
	const events = new CodingSessionEventStore(dbPath, {
		journalMode: "DELETE",
		storageOwnerId,
	});
	return { dbPath, sessions, codingSessions, events };
}

function seedCodingSession(
	sessions: SessionStore,
	codingSessions: CodingSessionStore,
	sdkSessionId: string,
) {
	sessions.upsert({
		providerId: "codex",
		sdkSessionId,
		title: "demo",
		model: "gpt-5.5",
		source: "code",
		tag: "code",
		timestamp: 1,
	});
	codingSessions.upsert({
		providerId: "codex",
		sdkSessionId,
		cwd: "/repo",
		runStatus: "running",
		timestamp: 1,
	});
}

describe("CodingSessionEventStore", () => {
	test("assigns monotonic sequence numbers per session", () => {
		const { sessions, codingSessions, events } = createStores();
		seedCodingSession(sessions, codingSessions, "s1");
		seedCodingSession(sessions, codingSessions, "s2");

		const a = events.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: { type: "text", text: "hi", sessionId: "s1" },
		});
		const b = events.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: { type: "text", text: " there", sessionId: "s1" },
		});
		const c = events.append({
			providerId: "codex",
			sdkSessionId: "s2",
			event: { type: "text", text: "other", sessionId: "s2" },
		});

		expect(a.sequence).toBe(1);
		expect(b.sequence).toBe(2);
		expect(c.sequence).toBe(1);
	});

	test("list returns events in sequence order with payloads intact", () => {
		const { sessions, codingSessions, events } = createStores();
		seedCodingSession(sessions, codingSessions, "s1");

		events.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: { type: "text", text: "hello", sessionId: "s1" },
			timestamp: 10,
		});
		events.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: { type: "thinking", text: "...", sessionId: "s1" },
			timestamp: 11,
		});
		events.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: {
				type: "done",
				sessionId: "s1",
				durationMs: 100,
			},
			timestamp: 12,
		});

		const stored = events.list({ providerId: "codex", sdkSessionId: "s1" });
		expect(stored).toEqual([
			{
				providerId: "codex",
				sdkSessionId: "s1",
				sequence: 1,
				event: { type: "text", text: "hello", sessionId: "s1" },
				createdAt: 10,
			},
			{
				providerId: "codex",
				sdkSessionId: "s1",
				sequence: 2,
				event: { type: "thinking", text: "...", sessionId: "s1" },
				createdAt: 11,
			},
			{
				providerId: "codex",
				sdkSessionId: "s1",
				sequence: 3,
				event: { type: "done", sessionId: "s1", durationMs: 100 },
				createdAt: 12,
			},
		]);
	});

	test("list({ sinceSequence }) returns only events after the cursor", () => {
		const { sessions, codingSessions, events } = createStores();
		seedCodingSession(sessions, codingSessions, "s1");
		events.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: { type: "text", text: "a", sessionId: "s1" },
		});
		events.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: { type: "text", text: "b", sessionId: "s1" },
		});
		events.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: { type: "text", text: "c", sessionId: "s1" },
		});

		const tail = events.list({
			providerId: "codex",
			sdkSessionId: "s1",
			sinceSequence: 1,
		});
		expect(tail.map((entry) => entry.event)).toEqual([
			{ type: "text", text: "b", sessionId: "s1" },
			{ type: "text", text: "c", sessionId: "s1" },
		]);
	});

	test("deleting a coding session cascades to its events", () => {
		const { sessions, codingSessions, events } = createStores();
		seedCodingSession(sessions, codingSessions, "s1");
		events.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: { type: "text", text: "a", sessionId: "s1" },
		});

		codingSessions.delete("codex", "s1");

		const stored = events.list({ providerId: "codex", sdkSessionId: "s1" });
		expect(stored).toEqual([]);
	});

	test("notifies live subscribers when events are appended", () => {
		const { sessions, codingSessions, events } = createStores();
		seedCodingSession(sessions, codingSessions, "s1");
		seedCodingSession(sessions, codingSessions, "s2");
		const received: StoredCodingSessionEvent[] = [];
		const unsubscribe = events.subscribe(
			{ providerId: "codex", sdkSessionId: "s1" },
			(stored) => received.push(stored),
		);

		events.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: { type: "text", text: "hi", sessionId: "s1" },
			timestamp: 5,
		});
		events.append({
			providerId: "codex",
			sdkSessionId: "s2",
			event: { type: "text", text: "ignore", sessionId: "s2" },
			timestamp: 6,
		});

		unsubscribe();
		events.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: { type: "text", text: "after unsubscribe", sessionId: "s1" },
			timestamp: 7,
		});

		expect(received).toEqual([
			{
				providerId: "codex",
				sdkSessionId: "s1",
				sequence: 1,
				event: { type: "text", text: "hi", sessionId: "s1" },
				createdAt: 5,
			},
		]);
	});

	test("supports multiple subscribers on the same session", () => {
		const { sessions, codingSessions, events } = createStores();
		seedCodingSession(sessions, codingSessions, "s1");
		const a: StoredCodingSessionEvent[] = [];
		const b: StoredCodingSessionEvent[] = [];
		events.subscribe({ providerId: "codex", sdkSessionId: "s1" }, (stored) =>
			a.push(stored),
		);
		events.subscribe({ providerId: "codex", sdkSessionId: "s1" }, (stored) =>
			b.push(stored),
		);

		events.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: { type: "text", text: "hi", sessionId: "s1" },
			timestamp: 10,
		});

		expect(a).toHaveLength(1);
		expect(b).toHaveLength(1);
		expect(a[0]?.sequence).toBe(1);
	});

	test("replayThenFollow yields persisted events then live events without gaps or duplicates", async () => {
		const { sessions, codingSessions, events } = createStores();
		seedCodingSession(sessions, codingSessions, "s1");
		events.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: { type: "text", text: "a", sessionId: "s1" },
		});
		events.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: { type: "text", text: "b", sessionId: "s1" },
		});

		const controller = new AbortController();
		const iterator = replayThenFollowCodingSessionEvents(events, {
			providerId: "codex",
			sdkSessionId: "s1",
			signal: controller.signal,
		})[Symbol.asyncIterator]();

		const first = await iterator.next();
		const second = await iterator.next();
		expect(first.value?.event).toEqual({
			type: "text",
			text: "a",
			sessionId: "s1",
		});
		expect(second.value?.event).toEqual({
			type: "text",
			text: "b",
			sessionId: "s1",
		});

		const live = iterator.next();
		events.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: { type: "text", text: "c", sessionId: "s1" },
		});
		const third = await live;
		expect(third.value?.event).toEqual({
			type: "text",
			text: "c",
			sessionId: "s1",
		});
		expect(third.value?.sequence).toBe(3);

		controller.abort();
		await iterator.next();
	});

	test("replayThenFollow honors sinceSequence and skips duplicates at the seam", async () => {
		const { sessions, codingSessions, events } = createStores();
		seedCodingSession(sessions, codingSessions, "s1");
		// Pre-existing persisted events.
		const persisted: StoredCodingSessionEvent[] = [];
		persisted.push(
			events.append({
				providerId: "codex",
				sdkSessionId: "s1",
				event: { type: "text", text: "a", sessionId: "s1" },
			}),
		);
		persisted.push(
			events.append({
				providerId: "codex",
				sdkSessionId: "s1",
				event: { type: "text", text: "b", sessionId: "s1" },
			}),
		);
		persisted.push(
			events.append({
				providerId: "codex",
				sdkSessionId: "s1",
				event: { type: "text", text: "c", sessionId: "s1" },
			}),
		);

		const controller = new AbortController();
		const iterator = replayThenFollowCodingSessionEvents(events, {
			providerId: "codex",
			sdkSessionId: "s1",
			sinceSequence: 2,
			signal: controller.signal,
		})[Symbol.asyncIterator]();

		const first = await iterator.next();
		expect(first.value?.sequence).toBe(3);

		controller.abort();
		await iterator.next();
	});

	test("scopes events to a single storage owner", () => {
		const owner = "__coding-test__";
		const { dbPath, sessions, codingSessions, events } = createStores(owner);
		seedCodingSession(sessions, codingSessions, "s1");
		events.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: { type: "text", text: "a", sessionId: "s1" },
		});

		const stranger = new CodingSessionEventStore(dbPath, {
			journalMode: "DELETE",
			storageOwnerId: "__other__",
		});
		const visible = stranger.list({
			providerId: "codex",
			sdkSessionId: "s1",
		});
		expect(visible).toEqual([]);
	});
});
