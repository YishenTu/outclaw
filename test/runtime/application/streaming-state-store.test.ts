import { describe, expect, test } from "bun:test";
import { StreamingStateStore } from "../../../src/runtime/application/prompt-execution/streaming-state-store.ts";

describe("StreamingStateStore", () => {
	test("records text, thinking, and images for an active session snapshot", () => {
		const store = new StreamingStateStore();
		store.start("claude", "sdk-123");

		store.recordEvent("claude", "sdk-123", { type: "thinking", text: "plan " });
		store.recordEvent("claude", "sdk-123", { type: "text", text: "hello " });
		store.recordEvent("claude", "sdk-123", { type: "text", text: "world" });
		store.recordEvent("claude", "sdk-123", {
			type: "image",
			path: "/tmp/cat.png",
			mediaType: "image/png",
		});

		expect(store.get("claude", "sdk-123")).toEqual({
			thinking: "plan ",
			text: "hello world",
			images: [
				{
					kind: "managed",
					path: "/tmp/cat.png",
					mediaType: "image/png",
				},
			],
		});
	});

	test("returns copies and ignores events for inactive sessions", () => {
		const store = new StreamingStateStore();
		store.recordEvent("claude", "missing", { type: "text", text: "ignored" });
		expect(store.get("claude", "missing")).toBeUndefined();

		store.start("claude", "sdk-123");
		store.recordEvent("claude", "sdk-123", {
			type: "image",
			path: "/tmp/a.png",
		});
		const snapshot = store.get("claude", "sdk-123");
		snapshot?.images.push({
			kind: "managed",
			path: "/tmp/mutated.png",
			mediaType: "image/png",
		});

		expect(store.get("claude", "sdk-123")?.images).toEqual([
			{
				kind: "managed",
				path: "/tmp/a.png",
				mediaType: "image/png",
			},
		]);
	});

	test("clears snapshots when a run leaves streaming state", () => {
		const store = new StreamingStateStore();
		store.start("claude", "sdk-123");
		store.recordEvent("claude", "sdk-123", {
			type: "text",
			text: "partial",
		});

		store.clear("claude", "sdk-123");

		expect(store.get("claude", "sdk-123")).toBeUndefined();
	});
});
