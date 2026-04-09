import { describe, expect, test } from "bun:test";
import {
	deleteBack,
	deleteForward,
	deleteWordBack,
	insertAt,
	killToLineEnd,
	killToLineStart,
	moveHorizontal,
	moveToLineEnd,
	moveToLineStart,
	moveVertical,
} from "../../../../src/frontend/tui/composer/edit.ts";
import { resolveTextAreaCursor } from "../../../../src/frontend/tui/composer/text-area.tsx";

describe("insertAt", () => {
	test("inserts at middle", () => {
		expect(insertAt("abcd", 2, "X")).toEqual({ value: "abXcd", cursor: 3 });
	});

	test("inserts at start", () => {
		expect(insertAt("abc", 0, "X")).toEqual({ value: "Xabc", cursor: 1 });
	});

	test("inserts at end", () => {
		expect(insertAt("abc", 3, "X")).toEqual({ value: "abcX", cursor: 4 });
	});

	test("inserts multi-char (paste)", () => {
		expect(insertAt("ac", 1, "bb")).toEqual({ value: "abbc", cursor: 3 });
	});

	test("inserts newline", () => {
		expect(insertAt("ab", 1, "\n")).toEqual({ value: "a\nb", cursor: 2 });
	});
});

describe("deleteBack", () => {
	test("deletes from middle", () => {
		expect(deleteBack("abc", 2)).toEqual({ value: "ac", cursor: 1 });
	});

	test("no-op at start", () => {
		expect(deleteBack("abc", 0)).toEqual({ value: "abc", cursor: 0 });
	});

	test("deletes newline", () => {
		expect(deleteBack("a\nb", 2)).toEqual({ value: "ab", cursor: 1 });
	});
});

describe("deleteForward", () => {
	test("deletes from middle", () => {
		expect(deleteForward("abc", 1)).toEqual({ value: "ac", cursor: 1 });
	});

	test("no-op at end", () => {
		expect(deleteForward("abc", 3)).toEqual({ value: "abc", cursor: 3 });
	});
});

describe("killToLineStart", () => {
	test("kills on single line", () => {
		expect(killToLineStart("hello", 3)).toEqual({
			value: "lo",
			cursor: 0,
		});
	});

	test("kills on second line", () => {
		expect(killToLineStart("ab\ncde", 5)).toEqual({
			value: "ab\ne",
			cursor: 3,
		});
	});

	test("deletes the previous line at line start", () => {
		expect(killToLineStart("ab\ncd", 3)).toEqual({
			value: "cd",
			cursor: 0,
		});
	});

	test("deletes only the previous line and keeps earlier lines", () => {
		expect(killToLineStart("xy\nab\ncd", 6)).toEqual({
			value: "xy\ncd",
			cursor: 3,
		});
	});
});

describe("killToLineEnd", () => {
	test("kills on single line", () => {
		expect(killToLineEnd("hello", 2)).toEqual({
			value: "he",
			cursor: 2,
		});
	});

	test("kills on first line of multi-line", () => {
		expect(killToLineEnd("abc\ndef", 1)).toEqual({
			value: "a\ndef",
			cursor: 1,
		});
	});

	test("no-op at line end", () => {
		expect(killToLineEnd("ab\ncd", 2)).toEqual({
			value: "ab\ncd",
			cursor: 2,
		});
	});
});

describe("deleteWordBack", () => {
	test("deletes word with trailing spaces", () => {
		expect(deleteWordBack("hello world ", 12)).toEqual({
			value: "hello ",
			cursor: 6,
		});
	});

	test("deletes word without trailing spaces", () => {
		expect(deleteWordBack("hello world", 11)).toEqual({
			value: "hello ",
			cursor: 6,
		});
	});

	test("no-op at start", () => {
		expect(deleteWordBack("hello", 0)).toEqual({
			value: "hello",
			cursor: 0,
		});
	});

	test("deletes newline when cursor is right after it", () => {
		expect(deleteWordBack("abc\ndef", 4)).toEqual({
			value: "abcdef",
			cursor: 3,
		});
	});
});

describe("moveHorizontal", () => {
	test("moves left", () => {
		expect(moveHorizontal("abc", 2, -1)).toBe(1);
	});

	test("moves right", () => {
		expect(moveHorizontal("abc", 1, 1)).toBe(2);
	});

	test("clamps at 0", () => {
		expect(moveHorizontal("abc", 0, -1)).toBe(0);
	});

	test("clamps at length", () => {
		expect(moveHorizontal("abc", 3, 1)).toBe(3);
	});
});

describe("moveVertical", () => {
	test("moves up one line", () => {
		// "ab\ncd" cursor at 4 (d) → should go to position 1 (b)
		expect(moveVertical("ab\ncd", 4, -1)).toBe(1);
	});

	test("moves down one line", () => {
		// "ab\ncd" cursor at 1 (b) → should go to position 4 (d)
		expect(moveVertical("ab\ncd", 1, 1)).toBe(4);
	});

	test("clamps column to shorter line", () => {
		// "abcde\nxy" cursor at 4 (e) → down to "xy" clamps to position 8 (after y)
		expect(moveVertical("abcde\nxy", 4, 1)).toBe(8);
	});

	test("no-op at first line going up", () => {
		expect(moveVertical("abc\ndef", 1, -1)).toBe(1);
	});

	test("no-op at last line going down", () => {
		expect(moveVertical("abc\ndef", 5, 1)).toBe(5);
	});

	test("three lines navigates correctly", () => {
		// "ab\ncd\nef" cursor at 7 (f, col 1) → up to position 4 (d, col 1)
		expect(moveVertical("ab\ncd\nef", 7, -1)).toBe(4);
	});
});

describe("moveToLineStart", () => {
	test("moves from middle", () => {
		expect(moveToLineStart("hello", 3)).toBe(0);
	});

	test("no-op at start", () => {
		expect(moveToLineStart("hello", 0)).toBe(0);
	});

	test("second line", () => {
		// "ab\ncd" cursor at 4 (d) → line start at 3 (c)
		expect(moveToLineStart("ab\ncd", 4)).toBe(3);
	});
});

describe("moveToLineEnd", () => {
	test("moves from middle", () => {
		expect(moveToLineEnd("hello", 2)).toBe(5);
	});

	test("no-op at end", () => {
		expect(moveToLineEnd("hello", 5)).toBe(5);
	});

	test("first line of multi-line", () => {
		// "ab\ncd" cursor at 0 → line end at 2
		expect(moveToLineEnd("ab\ncd", 0)).toBe(2);
	});
});

describe("resolveTextAreaCursor", () => {
	test("uses the override immediately when provided", () => {
		expect(resolveTextAreaCursor("hello!", 0, 6)).toBe(6);
	});

	test("clamps the override to the current value length", () => {
		expect(resolveTextAreaCursor("hello", 0, 99)).toBe(5);
	});

	test("falls back to the internal cursor when there is no override", () => {
		expect(resolveTextAreaCursor("hello", 3)).toBe(3);
	});

	test("clamps the internal cursor to the current value length", () => {
		expect(resolveTextAreaCursor("hello", 99)).toBe(5);
	});
});
