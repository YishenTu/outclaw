import { describe, expect, test } from "bun:test";
import type { Key } from "ink";
import {
	deleteWordForward,
	moveWordBack,
	moveWordForward,
} from "../../src/frontend/tui/text-area-edit.ts";
import { normalizeTextAreaInput } from "../../src/frontend/tui/text-area-input.ts";
import { applyTextAreaKeypress } from "../../src/frontend/tui/text-area-keypress.ts";

function key(overrides: Partial<Key> = {}): Key {
	return {
		upArrow: false,
		downArrow: false,
		leftArrow: false,
		rightArrow: false,
		pageDown: false,
		pageUp: false,
		home: false,
		end: false,
		return: false,
		escape: false,
		ctrl: false,
		shift: false,
		tab: false,
		backspace: false,
		delete: false,
		meta: false,
		super: false,
		hyper: false,
		capsLock: false,
		numLock: false,
		...overrides,
	};
}

describe("moveWordBack", () => {
	test("moves to the start of the previous word", () => {
		expect(moveWordBack("hello world", 11)).toBe(6);
	});

	test("steps through punctuation separately", () => {
		expect(moveWordBack("foo.bar", 7)).toBe(4);
		expect(moveWordBack("foo.bar", 4)).toBe(3);
	});

	test("moves across a newline one boundary at a time", () => {
		expect(moveWordBack("abc\ndef", 4)).toBe(3);
	});
});

describe("moveWordForward", () => {
	test("moves to the end of the current word", () => {
		expect(moveWordForward("hello world", 0)).toBe(5);
	});

	test("skips whitespace before the next word", () => {
		expect(moveWordForward("hello world", 5)).toBe(11);
	});

	test("moves across a newline one boundary at a time", () => {
		expect(moveWordForward("abc\ndef", 3)).toBe(4);
	});
});

describe("deleteWordForward", () => {
	test("deletes the current word from the cursor", () => {
		expect(deleteWordForward("hello world", 6)).toEqual({
			value: "hello ",
			cursor: 6,
		});
	});

	test("deletes the newline when the cursor is on it", () => {
		expect(deleteWordForward("abc\ndef", 3)).toEqual({
			value: "abcdef",
			cursor: 3,
		});
	});
});

describe("normalizeTextAreaInput", () => {
	test("preserves DEL as a delete key with the original sequence", () => {
		expect(normalizeTextAreaInput("\x7f")).toMatchObject({
			input: "",
			sequence: "\x7f",
			key: { delete: true, backspace: false, meta: false },
		});
	});

	test("preserves CSI delete separately from DEL", () => {
		expect(normalizeTextAreaInput("\x1b[3~")).toMatchObject({
			input: "",
			sequence: "\x1b[3~",
			key: { delete: true, backspace: false, meta: false },
		});
	});
});

describe("applyTextAreaKeypress", () => {
	test("Ctrl+B and Ctrl+F move horizontally", () => {
		expect(
			applyTextAreaKeypress(
				{ value: "abc", cursor: 2 },
				"b",
				key({ ctrl: true }),
			),
		).toMatchObject({
			value: "abc",
			cursor: 1,
			handled: true,
			submit: false,
		});

		expect(
			applyTextAreaKeypress(
				{ value: "abc", cursor: 1 },
				"f",
				key({ ctrl: true }),
			),
		).toMatchObject({
			value: "abc",
			cursor: 2,
			handled: true,
			submit: false,
		});
	});

	test("Ctrl+P and Ctrl+N move vertically", () => {
		expect(
			applyTextAreaKeypress(
				{ value: "ab\ncd", cursor: 4 },
				"p",
				key({ ctrl: true }),
			),
		).toMatchObject({
			value: "ab\ncd",
			cursor: 1,
			handled: true,
			submit: false,
		});

		expect(
			applyTextAreaKeypress(
				{ value: "ab\ncd", cursor: 1 },
				"n",
				key({ ctrl: true }),
			),
		).toMatchObject({
			value: "ab\ncd",
			cursor: 4,
			handled: true,
			submit: false,
		});
	});

	test("vertical motion preserves the preferred column across shorter lines", () => {
		const firstMove = applyTextAreaKeypress(
			{ value: "abcd\nx\nabcd", cursor: 3, preferredColumn: null },
			"",
			key({ downArrow: true }),
		);

		expect(firstMove).toMatchObject({
			value: "abcd\nx\nabcd",
			cursor: 6,
			handled: true,
			submit: false,
			preferredColumn: 3,
		});

		expect(
			applyTextAreaKeypress(
				{
					value: firstMove.value,
					cursor: firstMove.cursor,
					preferredColumn: firstMove.preferredColumn,
				},
				"",
				key({ downArrow: true }),
			),
		).toMatchObject({
			value: "abcd\nx\nabcd",
			cursor: 10,
			handled: true,
			submit: false,
			preferredColumn: 3,
		});
	});

	test("Home and End move to line boundaries", () => {
		expect(
			applyTextAreaKeypress(
				{ value: "ab\ncde", cursor: 5 },
				"",
				key({ home: true }),
			),
		).toMatchObject({
			value: "ab\ncde",
			cursor: 3,
			handled: true,
			submit: false,
		});

		expect(
			applyTextAreaKeypress(
				{ value: "ab\ncde", cursor: 3 },
				"",
				key({ end: true }),
			),
		).toMatchObject({
			value: "ab\ncde",
			cursor: 6,
			handled: true,
			submit: false,
		});
	});

	test("Ctrl+U deletes the previous line when pressed at line start", () => {
		const firstKill = applyTextAreaKeypress(
			{ value: "ab\ncde", cursor: 5 },
			"u",
			key({ ctrl: true }),
		);

		expect(firstKill).toMatchObject({
			value: "ab\ne",
			cursor: 3,
			handled: true,
			submit: false,
		});

		expect(
			applyTextAreaKeypress(
				{ value: firstKill.value, cursor: firstKill.cursor },
				"u",
				key({ ctrl: true }),
			),
		).toMatchObject({
			value: "e",
			cursor: 0,
			handled: true,
			submit: false,
		});
	});

	test("Meta+B and Meta+F move by words", () => {
		expect(
			applyTextAreaKeypress(
				{ value: "hello world", cursor: 11 },
				"b",
				key({ meta: true }),
			),
		).toMatchObject({
			value: "hello world",
			cursor: 6,
			handled: true,
			submit: false,
		});

		expect(
			applyTextAreaKeypress(
				{ value: "hello world", cursor: 0 },
				"f",
				key({ meta: true }),
			),
		).toMatchObject({
			value: "hello world",
			cursor: 5,
			handled: true,
			submit: false,
		});
	});

	test("Meta+D deletes forward by word", () => {
		expect(
			applyTextAreaKeypress(
				{ value: "hello world", cursor: 6 },
				"d",
				key({ meta: true }),
			),
		).toMatchObject({
			value: "hello ",
			cursor: 6,
			handled: true,
			submit: false,
		});
	});

	test("Meta+Backspace deletes backward by word", () => {
		expect(
			applyTextAreaKeypress(
				{ value: "hello world", cursor: 11 },
				"",
				key({ meta: true, backspace: true }),
			),
		).toMatchObject({
			value: "hello ",
			cursor: 6,
			handled: true,
			submit: false,
		});
	});

	test("DEL backspace sequence deletes backward", () => {
		expect(
			applyTextAreaKeypress(
				{ value: "abc", cursor: 3 },
				"",
				key({ delete: true }),
				"\x7f",
			),
		).toMatchObject({
			value: "ab",
			cursor: 2,
			handled: true,
			submit: false,
		});
	});

	test("Meta+DEL backspace sequence deletes backward by word", () => {
		expect(
			applyTextAreaKeypress(
				{ value: "hello world", cursor: 11 },
				"",
				key({ meta: true, delete: true }),
				"\x1b\x7f",
			),
		).toMatchObject({
			value: "hello ",
			cursor: 6,
			handled: true,
			submit: false,
		});
	});

	test("forward delete sequence still deletes forward", () => {
		expect(
			applyTextAreaKeypress(
				{ value: "abc", cursor: 1 },
				"",
				key({ delete: true }),
				"\x1b[3~",
			),
		).toMatchObject({
			value: "ac",
			cursor: 1,
			handled: true,
			submit: false,
		});
	});

	test("Ctrl+H and Ctrl+D delete backward and forward", () => {
		expect(
			applyTextAreaKeypress(
				{ value: "abc", cursor: 2 },
				"h",
				key({ ctrl: true }),
			),
		).toMatchObject({
			value: "ac",
			cursor: 1,
			handled: true,
			submit: false,
		});

		expect(
			applyTextAreaKeypress(
				{ value: "abc", cursor: 1 },
				"d",
				key({ ctrl: true }),
			),
		).toMatchObject({
			value: "ac",
			cursor: 1,
			handled: true,
			submit: false,
		});
	});

	test("Meta+Return inserts a newline instead of submitting", () => {
		expect(
			applyTextAreaKeypress(
				{ value: "hello", cursor: 5 },
				"",
				key({ meta: true, return: true }),
			),
		).toMatchObject({
			value: "hello\n",
			cursor: 6,
			handled: true,
			submit: false,
		});
	});

	test("multi-line paste normalizes CRLF line endings", () => {
		expect(
			applyTextAreaKeypress(
				{ value: "", cursor: 0 },
				"line1\r\nline2\r\nline3",
				key(),
				"line1\r\nline2\r\nline3",
			),
		).toMatchObject({
			value: "line1\nline2\nline3",
			cursor: 17,
			handled: true,
			submit: false,
		});
	});

	test("Return submits the current value", () => {
		expect(
			applyTextAreaKeypress(
				{ value: "hello", cursor: 5 },
				"",
				key({ return: true }),
			),
		).toMatchObject({
			value: "hello",
			cursor: 5,
			handled: true,
			submit: true,
		});
	});

	test("Ctrl+Left and Ctrl+Right move by word when the terminal reports modifiers", () => {
		expect(
			applyTextAreaKeypress(
				{ value: "hello world", cursor: 11 },
				"",
				key({ ctrl: true, leftArrow: true }),
			),
		).toMatchObject({
			value: "hello world",
			cursor: 6,
			handled: true,
			submit: false,
		});

		expect(
			applyTextAreaKeypress(
				{ value: "hello world", cursor: 0 },
				"",
				key({ ctrl: true, rightArrow: true }),
			),
		).toMatchObject({
			value: "hello world",
			cursor: 5,
			handled: true,
			submit: false,
		});
	});
});
