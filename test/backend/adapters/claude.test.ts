import { describe, expect, test } from "bun:test";
import { ClaudeAdapter } from "../../../src/backend/adapters/claude.ts";
import type { FacadeEvent } from "../../../src/backend/types.ts";

describe("ClaudeAdapter", () => {
	test("implements Facade interface", () => {
		const adapter = new ClaudeAdapter();
		expect(adapter.run).toBeFunction();
	});

	test("run() returns an async iterable", () => {
		const adapter = new ClaudeAdapter();
		const result = adapter.run({ prompt: "hello" });
		expect(result[Symbol.asyncIterator]).toBeFunction();
	});

	test("run() yields text and done events for a simple prompt", async () => {
		const adapter = new ClaudeAdapter();
		const events: FacadeEvent[] = [];

		for await (const event of adapter.run({ prompt: "Say hi in one word." })) {
			events.push(event);
		}

		const textEvents = events.filter((e) => e.type === "text");
		const doneEvents = events.filter((e) => e.type === "done");

		expect(textEvents.length).toBeGreaterThan(0);
		expect(doneEvents.length).toBe(1);

		const done = doneEvents[0];
		expect(done).toBeDefined();
		expect(done?.type).toBe("done");
		if (done?.type === "done") {
			expect(done.sessionId).toBeString();
			expect(done.durationMs).toBeGreaterThan(0);
		}
	}, 30_000);

	test("run() supports abort", async () => {
		const adapter = new ClaudeAdapter();
		const abortController = new AbortController();
		const events: FacadeEvent[] = [];

		abortController.abort();

		for await (const event of adapter.run({
			prompt: "Write a long essay.",
			abortController,
		})) {
			events.push(event);
		}

		const errorOrDone = events.filter(
			(e) => e.type === "error" || e.type === "done",
		);
		expect(errorOrDone.length).toBeGreaterThan(0);
	}, 10_000);
});
