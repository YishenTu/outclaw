import { describe, expect, test } from "bun:test";
import {
	buildPromptWithReplyContext,
	createReplyContext,
	parsePromptWithReplyContext,
} from "../../src/common/reply-context.ts";

describe("createReplyContext", () => {
	test("returns undefined for missing text", () => {
		expect(createReplyContext(undefined)).toBeUndefined();
	});

	test("trims surrounding whitespace", () => {
		expect(createReplyContext("  quoted text  ")).toEqual({
			text: "quoted text",
		});
	});

	test("returns undefined for whitespace-only text", () => {
		expect(createReplyContext(" \n\t ")).toBeUndefined();
	});
});

describe("buildPromptWithReplyContext", () => {
	test("returns the original prompt when no reply context exists", () => {
		expect(buildPromptWithReplyContext("hello", undefined)).toBe("hello");
	});

	test("wraps reply context in an escaped envelope", () => {
		expect(
			buildPromptWithReplyContext("what do you mean?", {
				text: 'the "cron" output <ok>\n[part 2] & more',
			}),
		).toBe(
			"what do you mean?\n\n<reply-context>the &quot;cron&quot; output &lt;ok&gt;\n[part 2] &amp; more</reply-context>",
		);
	});

	test("supports reply-only multimodal prompts", () => {
		expect(
			buildPromptWithReplyContext("", {
				text: "describe the photo I replied to",
			}),
		).toBe("<reply-context>describe the photo I replied to</reply-context>");
	});
});

describe("parsePromptWithReplyContext", () => {
	test("returns the original prompt when no envelope exists", () => {
		expect(parsePromptWithReplyContext("hello")).toEqual({
			prompt: "hello",
			replyContext: undefined,
		});
	});

	test("extracts and unescapes reply context", () => {
		expect(
			parsePromptWithReplyContext(
				"what do you mean?\n\n<reply-context>the &quot;cron&quot; output &lt;ok&gt;\n[part 2] &amp; more</reply-context>",
			),
		).toEqual({
			prompt: "what do you mean?",
			replyContext: {
				text: 'the "cron" output <ok>\n[part 2] & more',
			},
		});
	});

	test("extracts reply-only multimodal prompts", () => {
		expect(
			parsePromptWithReplyContext(
				"<reply-context>describe the photo I replied to</reply-context>",
			),
		).toEqual({
			prompt: "",
			replyContext: { text: "describe the photo I replied to" },
		});
	});
});
