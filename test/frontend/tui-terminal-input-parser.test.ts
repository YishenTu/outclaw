import { describe, expect, test } from "bun:test";
import { createTerminalInputParser } from "../../src/frontend/tui/terminal-input-parser.ts";

describe("createTerminalInputParser", () => {
	test("splits control sequences from trailing text in a single chunk", () => {
		const parser = createTerminalInputParser();

		expect(parser.push("\x1b[Aa")).toEqual(["\x1b[A", "a"]);
	});

	test("holds a lone escape until it is flushed", () => {
		const parser = createTerminalInputParser();

		expect(parser.push("\x1b")).toEqual([]);
		expect(parser.hasPendingEscape()).toBe(true);
		expect(parser.flushPendingEscape()).toBe("\x1b");
		expect(parser.hasPendingEscape()).toBe(false);
	});
});
