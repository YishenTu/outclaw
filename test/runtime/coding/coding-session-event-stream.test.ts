import { describe, expect, test } from "bun:test";
import type { CodingSessionEvent } from "../../../src/common/protocol.ts";
import {
	CodingSessionEventHub,
	openCodingSessionEventStream,
} from "../../../src/runtime/coding/index.ts";

describe("openCodingSessionEventStream", () => {
	test("includes live events recorded before stream subscription when provider history is stale", async () => {
		const liveEvents = new CodingSessionEventHub();
		liveEvents.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: { type: "session_initialized", sessionId: "s1" },
			timestamp: 10,
		});
		liveEvents.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: { type: "user_prompt", text: "fresh start", sessionId: "s1" },
			timestamp: 11,
		});
		liveEvents.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: { type: "text", text: "early chunk", sessionId: "s1" },
			timestamp: 12,
		});
		const controller = new AbortController();
		const iterator = openCodingSessionEventStream({
			history: {
				readCodingSessionEvents: async () => [
					{ type: "session_initialized", sessionId: "s1" },
				],
			},
			liveEvents,
			providerId: "codex",
			sdkSessionId: "s1",
			signal: controller.signal,
		})[Symbol.asyncIterator]();

		try {
			expect((await nextOrTimeout(iterator)).value).toMatchObject({
				sequence: 1,
				event: { type: "session_initialized", sessionId: "s1" },
			});
			expect((await nextOrTimeout(iterator)).value).toMatchObject({
				sequence: 2,
				event: { type: "user_prompt", text: "fresh start", sessionId: "s1" },
			});
			expect((await nextOrTimeout(iterator)).value).toMatchObject({
				sequence: 3,
				event: { type: "text", text: "early chunk", sessionId: "s1" },
			});

			const live = iterator.next();
			liveEvents.append({
				providerId: "codex",
				sdkSessionId: "s1",
				event: { type: "text", text: "future chunk", sessionId: "s1" },
				timestamp: 20,
			});
			expect(await live).toEqual({
				done: false,
				value: {
					providerId: "codex",
					sdkSessionId: "s1",
					sequence: 4,
					event: { type: "text", text: "future chunk", sessionId: "s1" },
					createdAt: 20,
				},
			});
		} finally {
			controller.abort();
			await iterator.next();
			liveEvents.close();
		}
	});

	test("uses a complete fresh live snapshot instead of mixing it with condensed provider history", async () => {
		const liveEvents = new CodingSessionEventHub();
		liveEvents.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: { type: "session_initialized", sessionId: "s1" },
			timestamp: 10,
		});
		liveEvents.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: { type: "user_prompt", text: "fresh start", sessionId: "s1" },
			timestamp: 11,
		});
		liveEvents.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: { type: "text", text: "hel", sessionId: "s1" },
			timestamp: 12,
		});
		liveEvents.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: { type: "text", text: "lo", sessionId: "s1" },
			timestamp: 13,
		});
		liveEvents.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: { type: "done", sessionId: "s1", durationMs: 4 },
			timestamp: 14,
		});
		const controller = new AbortController();
		const iterator = openCodingSessionEventStream({
			history: {
				readCodingSessionEvents: async () => [
					{ type: "user_prompt", text: "fresh start", sessionId: "s1" },
					{ type: "text", text: "hello", sessionId: "s1" },
					{ type: "done", sessionId: "s1", durationMs: 4 },
				],
			},
			liveEvents,
			providerId: "codex",
			sdkSessionId: "s1",
			signal: controller.signal,
		})[Symbol.asyncIterator]();

		try {
			const emitted = [
				(await nextOrTimeout(iterator)).value?.event,
				(await nextOrTimeout(iterator)).value?.event,
				(await nextOrTimeout(iterator)).value?.event,
				(await nextOrTimeout(iterator)).value?.event,
				(await nextOrTimeout(iterator)).value?.event,
			];
			expect(emitted).toEqual([
				{ type: "session_initialized", sessionId: "s1" },
				{ type: "user_prompt", text: "fresh start", sessionId: "s1" },
				{ type: "text", text: "hel", sessionId: "s1" },
				{ type: "text", text: "lo", sessionId: "s1" },
				{ type: "done", sessionId: "s1", durationMs: 4 },
			]);
		} finally {
			controller.abort();
			await iterator.next();
			liveEvents.close();
		}
	});

	test("can hydrate history and live snapshot without following future events", async () => {
		const liveEvents = new CodingSessionEventHub();
		liveEvents.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: { type: "session_initialized", sessionId: "s1" },
			timestamp: 10,
		});
		liveEvents.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: { type: "text", text: "snapshot", sessionId: "s1" },
			timestamp: 11,
		});
		const iterator = openCodingSessionEventStream({
			history: {
				readCodingSessionEvents: async () => [
					{ type: "session_initialized", sessionId: "s1" },
				],
			},
			liveEvents,
			providerId: "codex",
			sdkSessionId: "s1",
			follow: false,
		})[Symbol.asyncIterator]();

		try {
			expect((await nextOrTimeout(iterator)).value?.event).toEqual({
				type: "session_initialized",
				sessionId: "s1",
			});
			expect((await nextOrTimeout(iterator)).value?.event).toEqual({
				type: "text",
				text: "snapshot",
				sessionId: "s1",
			});
			liveEvents.append({
				providerId: "codex",
				sdkSessionId: "s1",
				event: { type: "text", text: "future", sessionId: "s1" },
				timestamp: 12,
			});
			await expect(iterator.next()).resolves.toEqual({
				done: true,
				value: undefined,
			});
		} finally {
			liveEvents.close();
		}
	});

	test("reads provider history before following live events", async () => {
		const liveEvents = new CodingSessionEventHub();
		const controller = new AbortController();
		const iterator = openCodingSessionEventStream({
			history: {
				readCodingSessionEvents: async () => [
					{ type: "user_prompt", text: "inspect", sessionId: "s1" },
					{ type: "text", text: "history", sessionId: "s1" },
				],
			},
			liveEvents,
			providerId: "codex",
			sdkSessionId: "s1",
			signal: controller.signal,
		})[Symbol.asyncIterator]();

		expect((await iterator.next()).value).toMatchObject({
			sequence: 1,
			event: { type: "user_prompt", text: "inspect", sessionId: "s1" },
		});
		expect((await iterator.next()).value).toMatchObject({
			sequence: 2,
			event: { type: "text", text: "history", sessionId: "s1" },
		});

		const live = iterator.next();
		liveEvents.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: { type: "text", text: "live", sessionId: "s1" },
			timestamp: 30,
		});
		expect(await live).toEqual({
			done: false,
			value: {
				providerId: "codex",
				sdkSessionId: "s1",
				sequence: 3,
				event: { type: "text", text: "live", sessionId: "s1" },
				createdAt: 30,
			},
		});

		controller.abort();
		await iterator.next();
		liveEvents.close();
	});

	test("rejects unknown persisted coding sessions before reading history", async () => {
		let historyRead = false;
		const iterator = openCodingSessionEventStream({
			history: {
				readCodingSessionEvents: async () => {
					historyRead = true;
					return [];
				},
			},
			sessions: {
				hasCodingSession: () => false,
			},
			providerId: "codex",
			sdkSessionId: "missing",
			follow: false,
		})[Symbol.asyncIterator]();

		await expect(iterator.next()).rejects.toThrow(
			"Unknown coding session: codex/missing",
		);
		expect(historyRead).toBe(false);
	});

	test("buffers live events while provider history is loading", async () => {
		const liveEvents = new CodingSessionEventHub();
		let resolveHistory: (events: CodingSessionEvent[]) => void = () => {};
		const history = new Promise<CodingSessionEvent[]>((resolve) => {
			resolveHistory = resolve;
		});
		const controller = new AbortController();
		const iterator = openCodingSessionEventStream({
			history: {
				readCodingSessionEvents: async () => history,
			},
			liveEvents,
			providerId: "codex",
			sdkSessionId: "s1",
			signal: controller.signal,
		})[Symbol.asyncIterator]();

		const first = iterator.next();
		await Promise.resolve();
		liveEvents.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: { type: "text", text: "live", sessionId: "s1" },
			timestamp: 20,
		});
		resolveHistory([{ type: "text", text: "history", sessionId: "s1" }]);

		expect((await first).value).toMatchObject({
			sequence: 1,
			event: { type: "text", text: "history", sessionId: "s1" },
		});
		expect((await iterator.next()).value).toEqual({
			providerId: "codex",
			sdkSessionId: "s1",
			sequence: 2,
			event: { type: "text", text: "live", sessionId: "s1" },
			createdAt: 20,
		});

		controller.abort();
		await iterator.next();
		liveEvents.close();
	});

	test("deduplicates only the live suffix already present in provider history", async () => {
		const liveEvents = new CodingSessionEventHub();
		let resolveHistory: (events: CodingSessionEvent[]) => void = () => {};
		const history = new Promise<CodingSessionEvent[]>((resolve) => {
			resolveHistory = resolve;
		});
		const repeatedEvent: CodingSessionEvent = {
			type: "user_prompt",
			text: "go on",
			sessionId: "s1",
		};
		const controller = new AbortController();
		const iterator = openCodingSessionEventStream({
			history: {
				readCodingSessionEvents: async () => history,
			},
			liveEvents,
			providerId: "codex",
			sdkSessionId: "s1",
			signal: controller.signal,
		})[Symbol.asyncIterator]();

		const first = iterator.next();
		await Promise.resolve();
		liveEvents.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: repeatedEvent,
			timestamp: 20,
		});
		resolveHistory([
			repeatedEvent,
			{ type: "text", text: "history suffix", sessionId: "s1" },
		]);

		expect((await first).value?.event).toEqual(repeatedEvent);
		expect((await iterator.next()).value?.event).toEqual({
			type: "text",
			text: "history suffix",
			sessionId: "s1",
		});
		expect((await iterator.next()).value).toEqual({
			providerId: "codex",
			sdkSessionId: "s1",
			sequence: 3,
			event: repeatedEvent,
			createdAt: 20,
		});

		controller.abort();
		await iterator.next();
		liveEvents.close();
	});
});

async function nextOrTimeout<T>(
	iterator: AsyncIterator<T>,
): Promise<IteratorResult<T>> {
	return await Promise.race([
		iterator.next(),
		Bun.sleep(20).then(() => {
			throw new Error("Timed out waiting for coding stream event");
		}),
	]);
}
