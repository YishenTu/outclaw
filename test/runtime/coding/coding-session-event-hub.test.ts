import { describe, expect, test } from "bun:test";
import {
	CodingSessionEventHub,
	type StoredCodingSessionEvent,
} from "../../../src/runtime/coding/index.ts";

describe("CodingSessionEventHub", () => {
	test("assigns monotonic sequence numbers per live provider session", () => {
		const events = new CodingSessionEventHub();

		const first = events.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: { type: "text", text: "a", sessionId: "s1" },
			timestamp: 10,
		});
		const second = events.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: { type: "text", text: "b", sessionId: "s1" },
			timestamp: 11,
		});
		const otherSession = events.append({
			providerId: "codex",
			sdkSessionId: "s2",
			event: { type: "text", text: "c", sessionId: "s2" },
			timestamp: 12,
		});
		const otherProvider = events.append({
			providerId: "claude",
			sdkSessionId: "s1",
			event: { type: "text", text: "d", sessionId: "s1" },
			timestamp: 13,
		});

		expect(first.sequence).toBe(1);
		expect(second.sequence).toBe(2);
		expect(otherSession.sequence).toBe(1);
		expect(otherProvider.sequence).toBe(1);
		expect(first.createdAt).toBe(10);
	});

	test("notifies subscribers only for the matching live provider session", () => {
		const events = new CodingSessionEventHub();
		const received: StoredCodingSessionEvent[] = [];

		events.subscribe({ providerId: "codex", sdkSessionId: "s1" }, (event) => {
			received.push(event);
		});

		events.append({
			providerId: "codex",
			sdkSessionId: "s2",
			event: { type: "text", text: "ignore session", sessionId: "s2" },
			timestamp: 1,
		});
		events.append({
			providerId: "claude",
			sdkSessionId: "s1",
			event: { type: "text", text: "ignore provider", sessionId: "s1" },
			timestamp: 2,
		});
		events.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: { type: "text", text: "deliver", sessionId: "s1" },
			timestamp: 3,
		});

		expect(received).toEqual([
			{
				providerId: "codex",
				sdkSessionId: "s1",
				sequence: 1,
				event: { type: "text", text: "deliver", sessionId: "s1" },
				createdAt: 3,
			},
		]);
	});

	test("returns a process-local snapshot for late coding stream subscribers", () => {
		const events = new CodingSessionEventHub();
		events.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: { type: "user_prompt", text: "go", sessionId: "s1" },
			timestamp: 10,
		});
		events.append({
			providerId: "codex",
			sdkSessionId: "s2",
			event: { type: "text", text: "other", sessionId: "s2" },
			timestamp: 11,
		});
		events.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: { type: "text", text: "done", sessionId: "s1" },
			timestamp: 12,
		});

		expect(
			events
				.snapshot({ providerId: "codex", sdkSessionId: "s1" })
				.map((event) => event.event),
		).toEqual([
			{ type: "user_prompt", text: "go", sessionId: "s1" },
			{ type: "text", text: "done", sessionId: "s1" },
		]);
	});

	test("notifies all-session subscribers for browser websocket delivery", () => {
		const events = new CodingSessionEventHub();
		const received: StoredCodingSessionEvent[] = [];
		const unsubscribe = events.subscribeAll((event) => {
			received.push(event);
		});

		events.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: { type: "text", text: "one", sessionId: "s1" },
			timestamp: 10,
		});
		events.append({
			providerId: "codex",
			sdkSessionId: "s2",
			event: { type: "text", text: "two", sessionId: "s2" },
			timestamp: 11,
		});
		unsubscribe();
		events.append({
			providerId: "codex",
			sdkSessionId: "s3",
			event: { type: "text", text: "three", sessionId: "s3" },
			timestamp: 12,
		});

		expect(received.map((event) => event.event)).toEqual([
			{ type: "text", text: "one", sessionId: "s1" },
			{ type: "text", text: "two", sessionId: "s2" },
		]);
	});

	test("unsubscribes without affecting other live subscribers", () => {
		const events = new CodingSessionEventHub();
		const first: StoredCodingSessionEvent[] = [];
		const second: StoredCodingSessionEvent[] = [];

		const unsubscribeFirst = events.subscribe(
			{ providerId: "codex", sdkSessionId: "s1" },
			(event) => first.push(event),
		);
		events.subscribe({ providerId: "codex", sdkSessionId: "s1" }, (event) =>
			second.push(event),
		);

		events.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: { type: "text", text: "before", sessionId: "s1" },
		});
		unsubscribeFirst();
		events.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: { type: "text", text: "after", sessionId: "s1" },
		});

		expect(first.map((event) => event.event)).toEqual([
			{ type: "text", text: "before", sessionId: "s1" },
		]);
		expect(second.map((event) => event.event)).toEqual([
			{ type: "text", text: "before", sessionId: "s1" },
			{ type: "text", text: "after", sessionId: "s1" },
		]);
	});

	test("close clears live subscribers and process-local sequence state", () => {
		const events = new CodingSessionEventHub();
		const received: StoredCodingSessionEvent[] = [];

		events.subscribe({ providerId: "codex", sdkSessionId: "s1" }, (event) => {
			received.push(event);
		});
		events.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: { type: "text", text: "before", sessionId: "s1" },
		});

		events.close();
		const afterClose = events.append({
			providerId: "codex",
			sdkSessionId: "s1",
			event: { type: "text", text: "after", sessionId: "s1" },
		});

		expect(received.map((event) => event.event)).toEqual([
			{ type: "text", text: "before", sessionId: "s1" },
		]);
		expect(afterClose.sequence).toBe(1);
	});
});
