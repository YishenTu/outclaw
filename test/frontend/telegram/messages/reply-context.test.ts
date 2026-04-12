import { describe, expect, test } from "bun:test";
import {
	extractReplyContext,
	extractReplyText,
} from "../../../../src/frontend/telegram/messages/reply-context.ts";

describe("extractReplyText", () => {
	test("returns undefined when no reply message", () => {
		expect(extractReplyText(undefined)).toBeUndefined();
	});

	test("returns text from reply message", () => {
		expect(extractReplyText({ text: "hello" })).toBe("hello");
	});

	test("returns caption when no text", () => {
		expect(extractReplyText({ caption: "photo caption" })).toBe(
			"photo caption",
		);
	});

	test("prefers text over caption", () => {
		expect(extractReplyText({ text: "msg", caption: "cap" })).toBe("msg");
	});

	test("returns undefined when neither text nor caption", () => {
		expect(extractReplyText({})).toBeUndefined();
	});
});

describe("extractReplyContext", () => {
	test("returns undefined when no reply message", () => {
		expect(extractReplyContext(undefined)).toBeUndefined();
	});

	test("returns normalized reply context from text", () => {
		expect(extractReplyContext({ text: "  the cron output  " })).toEqual({
			text: "the cron output",
		});
	});

	test("returns caption when text is missing", () => {
		expect(extractReplyContext({ caption: "photo caption" })).toEqual({
			text: "photo caption",
		});
	});

	test("returns undefined when extracted text is empty after trimming", () => {
		expect(extractReplyContext({ text: " \n\t " })).toBeUndefined();
	});
});
