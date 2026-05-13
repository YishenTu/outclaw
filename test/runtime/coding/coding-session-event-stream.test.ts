import { describe, expect, test } from "bun:test";
import type { CodingSessionEvent } from "../../../src/common/protocol.ts";
import {
	CodingSessionEventHub,
	openCodingSessionEventStream,
} from "../../../src/runtime/coding/index.ts";

describe("openCodingSessionEventStream", () => {
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
