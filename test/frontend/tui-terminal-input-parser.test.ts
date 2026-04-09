import { describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import {
	createTerminalInputParser,
	parseTerminalKeypress,
} from "../../src/frontend/tui/terminal-input-parser.ts";

describe("parseTerminalKeypress", () => {
	test("parses kitty printable keys with modifiers, repeat events, and text payload", () => {
		expect(parseTerminalKeypress("\x1b[97;39:2;65:769u")).toMatchObject({
			name: "a",
			ctrl: true,
			meta: true,
			option: true,
			eventType: "repeat",
			isKittyProtocol: true,
			isPrintable: true,
			text: "Á",
		});
	});

	test("parses kitty special keys with modifier flags and release events", () => {
		expect(parseTerminalKeypress("\x1b[3;5:3~")).toMatchObject({
			name: "delete",
			ctrl: true,
			eventType: "release",
			isKittyProtocol: true,
			isPrintable: false,
		});
	});

	test("falls back to a generic kitty event when the kitty codepoint is invalid", () => {
		expect(parseTerminalKeypress("\x1b[1114112u")).toMatchObject({
			name: "",
			ctrl: false,
			meta: false,
			shift: false,
			isKittyProtocol: true,
			isPrintable: false,
		});
	});

	test("parses classic modifier and function-key escape sequences", () => {
		expect(parseTerminalKeypress("\x1b[1;5C")).toMatchObject({
			name: "right",
			ctrl: true,
			sequence: "\x1b[1;5C",
		});

		expect(parseTerminalKeypress("\x1b\x1b[D")).toMatchObject({
			name: "left",
			option: true,
			sequence: "\x1b\x1b[D",
		});

		expect(parseTerminalKeypress("\x1b[Z")).toMatchObject({
			name: "tab",
			shift: true,
			sequence: "\x1b[Z",
		});

		expect(parseTerminalKeypress("\x1b\r")).toMatchObject({
			name: "return",
			option: true,
			sequence: "\x1b\r",
		});
	});

	test("normalizes single-byte high-bit buffers into escape-prefixed input", () => {
		expect(parseTerminalKeypress(Buffer.from([225]))).toMatchObject({
			meta: true,
			sequence: "\x1ba",
		});
	});
});

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

	test("reassembles CSI sequences split across chunks", () => {
		const parser = createTerminalInputParser();

		expect(parser.push("a\x1b[")).toEqual(["a"]);
		expect(parser.hasPendingEscape()).toBe(true);
		expect(parser.push("Ab")).toEqual(["\x1b[A", "b"]);
	});

	test("reassembles option-modified control sequences across chunks", () => {
		const parser = createTerminalInputParser();

		expect(parser.push("\x1b\x1b")).toEqual([]);
		expect(parser.hasPendingEscape()).toBe(true);
		expect(parser.push("[A")).toEqual(["\x1b\x1b[A"]);
	});

	test("treats escaped code points as standalone events", () => {
		const parser = createTerminalInputParser();

		expect(parser.push("x\x1ba😀")).toEqual(["x", "\x1ba", "😀"]);
	});

	test("accepts Buffer chunks and resets pending state", () => {
		const parser = createTerminalInputParser();

		expect(parser.push("\x1b[")).toEqual([]);
		expect(parser.hasPendingEscape()).toBe(true);
		parser.reset();
		expect(parser.hasPendingEscape()).toBe(false);
		expect(parser.push(Buffer.from("\x1b[A"))).toEqual(["\x1b[A"]);
		expect(parser.flushPendingEscape()).toBeUndefined();
	});
});
