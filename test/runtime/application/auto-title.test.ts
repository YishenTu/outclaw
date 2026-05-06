import { describe, expect, test } from "bun:test";
import { normalizeAutoTitle } from "../../../src/runtime/application/auto-title.ts";

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
