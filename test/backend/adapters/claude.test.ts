import { describe, expect, test } from "bun:test";
import { ClaudeAdapter } from "../../../src/backend/adapters/claude.ts";

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
});
