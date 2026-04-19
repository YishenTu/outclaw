import { describe, expect, test } from "bun:test";
import {
	formatContext,
	formatImage,
	formatLivePrompt,
	formatReplayMessage,
	formatReplyText,
} from "../../../../src/frontend/tui/transcript/format.ts";

describe("formatContext", () => {
	test("formats usage with compact numbers", () => {
		expect(
			formatContext({
				contextTokens: 1234,
				contextWindow: 200000,
				percentage: 1,
			}),
		).toBe("1k/200k (1%)");
	});

	test("formats millions", () => {
		expect(
			formatContext({
				contextTokens: 54321,
				contextWindow: 1000000,
				percentage: 5,
			}),
		).toBe("54k/1.0M (5%)");
	});

	test("formats small numbers without suffix", () => {
		expect(
			formatContext({
				contextTokens: 500,
				contextWindow: 200000,
				percentage: 0,
			}),
		).toBe("500/200k (0%)");
	});

	test("returns n/a when usage is undefined", () => {
		expect(formatContext(undefined)).toBe("n/a");
	});
});

describe("formatImage", () => {
	test("formats managed image without exposing the path", () => {
		expect(
			formatImage({
				kind: "managed",
				path: "/tmp/cat.png",
				mediaType: "image/png",
			}),
		).toBe("[image]");
	});

	test("formats inline replay images as placeholders", () => {
		expect(
			formatImage({
				kind: "inline",
				mediaType: "image/png",
				base64: "abc123",
			}),
		).toBe("[image]");
	});

	test("formats placeholder images as placeholders", () => {
		expect(formatImage({ kind: "placeholder", mediaType: "image/png" })).toBe(
			"[image]",
		);
	});
});

describe("formatLivePrompt", () => {
	test("formats prompt with source prefix", () => {
		expect(formatLivePrompt("telegram", "hello", undefined)).toBe(
			"[telegram] hello\n",
		);
	});

	test("omits the browser source prefix", () => {
		expect(formatLivePrompt("browser", "hello", undefined)).toBe("hello\n");
	});

	test("formats prompt with images", () => {
		expect(
			formatLivePrompt("telegram", "what is this?", [
				{ kind: "managed", path: "/tmp/cat.png", mediaType: "image/png" },
			]),
		).toBe("[telegram] what is this?\n[telegram] [image]\n");
	});

	test("formats image-only prompt", () => {
		expect(
			formatLivePrompt("telegram", "", [
				{ kind: "placeholder", mediaType: "image/png" },
			]),
		).toBe("[telegram] [image]\n");
	});

	test("returns empty string for empty prompt and no images", () => {
		expect(formatLivePrompt("tui", "", undefined)).toBe("");
	});
});

describe("formatReplyText", () => {
	test("returns raw reply content for the dedicated reply block", () => {
		expect(formatReplyText({ text: "the cron output" })).toBe(
			"the cron output",
		);
	});
});

describe("formatReplayMessage", () => {
	test("formats assistant message", () => {
		expect(
			formatReplayMessage({
				kind: "chat",
				role: "assistant",
				content: "Hello there",
			}),
		).toBe("Hello there\n");
	});

	test("formats user message with > prefix", () => {
		expect(
			formatReplayMessage({ kind: "chat", role: "user", content: "Question" }),
		).toBe("> Question\n");
	});

	test("formats user message with images", () => {
		expect(
			formatReplayMessage({
				kind: "chat",
				role: "user",
				content: "Question",
				images: [
					{
						kind: "inline",
						mediaType: "image/png",
						base64: "abc123",
					},
				],
			}),
		).toBe("> Question\n> [image]\n");
	});

	test("formats user message with reply context in the main message text", () => {
		expect(
			formatReplayMessage({
				kind: "chat",
				role: "user",
				content: "Question",
				replyContext: { text: "Earlier answer" },
			}),
		).toBe("> Question\n");
	});

	test("formats user message with image only (no text)", () => {
		expect(
			formatReplayMessage({
				kind: "chat",
				role: "user",
				content: "",
				images: [{ kind: "placeholder", mediaType: "image/png" }],
			}),
		).toBe("> [image]\n");
	});
});
