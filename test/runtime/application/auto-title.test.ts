import { describe, expect, test } from "bun:test";
import {
	buildAutoTitlePrompt,
	normalizeAutoTitle,
} from "../../../src/runtime/application/auto-title.ts";

describe("buildAutoTitlePrompt", () => {
	test("wraps the request with explicit title-only instructions", () => {
		const prompt = buildAutoTitlePrompt(
			"  Explain why the browser tab turns blank after auto title.  ",
		);

		expect(prompt).toContain("Do not answer the request");
		expect(prompt).toContain("Summarize the user's intent as a title only");
		expect(prompt).toContain(
			"<request>\nExplain why the browser tab turns blank after auto title.\n</request>",
		);
		expect(prompt).not.toBe(
			"Explain why the browser tab turns blank after auto title.",
		);
	});
});

describe("normalizeAutoTitle", () => {
	test("strips wrappers, keeps the first line, collapses whitespace, and trims trailing punctuation", () => {
		expect(
			normalizeAutoTitle('"  Debug   Telegram    delivery.  "\nextra text'),
		).toBe("Debug Telegram delivery");
		expect(normalizeAutoTitle("`Fix session rename?`")).toBe(
			"Fix session rename",
		);
	});

	test("caps long titles at a word boundary without adding an ellipsis", () => {
		expect(
			normalizeAutoTitle(
				"Investigate websocket routing regressions caused by stale session state in the browser sidebar",
			),
		).toBe("Investigate websocket routing regressions caused by stale");
	});

	test("returns undefined for empty normalized titles", () => {
		expect(normalizeAutoTitle(" \n ")).toBeUndefined();
		expect(normalizeAutoTitle("...")).toBeUndefined();
	});
});
