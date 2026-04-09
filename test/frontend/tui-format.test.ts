import { describe, expect, test } from "bun:test";
import {
	formatContext,
	formatImage,
	formatLivePrompt,
	formatReplayMessage,
} from "../../src/frontend/tui/format.ts";

describe("formatContext", () => {
	test("formats usage with tokens and percentage", () => {
		expect(
			formatContext({
				contextTokens: 1234,
				contextWindow: 200000,
				percentage: 1,
			}),
		).toBe("1,234/200,000 tokens (1%)");
	});

	test("returns n/a when usage is undefined", () => {
		expect(formatContext(undefined)).toBe("n/a");
	});
});

describe("formatImage", () => {
	test("formats image with path", () => {
		expect(formatImage({ path: "/tmp/cat.png", mediaType: "image/png" })).toBe(
			"[image: /tmp/cat.png]",
		);
	});

	test("formats image without path", () => {
		expect(formatImage({ mediaType: "image/png" })).toBe("[image]");
	});
});

describe("formatLivePrompt", () => {
	test("formats prompt with source prefix", () => {
		expect(formatLivePrompt("telegram", "hello", undefined)).toBe(
			"[telegram] hello\n",
		);
	});

	test("formats prompt with images", () => {
		expect(
			formatLivePrompt("telegram", "what is this?", [
				{ path: "/tmp/cat.png", mediaType: "image/png" },
			]),
		).toBe("[telegram] what is this?\n[telegram] [image: /tmp/cat.png]\n");
	});

	test("formats image-only prompt", () => {
		expect(formatLivePrompt("telegram", "", [{ mediaType: "image/png" }])).toBe(
			"[telegram] [image]\n",
		);
	});

	test("returns empty string for empty prompt and no images", () => {
		expect(formatLivePrompt("tui", "", undefined)).toBe("");
	});
});

describe("formatReplayMessage", () => {
	test("formats assistant message", () => {
		expect(
			formatReplayMessage({ role: "assistant", content: "Hello there" }),
		).toBe("Hello there\n");
	});

	test("formats user message with > prefix", () => {
		expect(formatReplayMessage({ role: "user", content: "Question" })).toBe(
			"> Question\n",
		);
	});

	test("formats user message with images", () => {
		expect(
			formatReplayMessage({
				role: "user",
				content: "Question",
				images: [{ path: "/tmp/cat.png", mediaType: "image/png" }],
			}),
		).toBe("> Question\n> [image: /tmp/cat.png]\n");
	});

	test("formats user message with image only (no text)", () => {
		expect(
			formatReplayMessage({
				role: "user",
				content: "",
				images: [{ mediaType: "image/png" }],
			}),
		).toBe("> [image]\n");
	});
});
