import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "../../src/frontend/tui/markdown.ts";

describe("renderMarkdown", () => {
	test("handles non-positive widths for horizontal rules", () => {
		expect(() => renderMarkdown("---", 0)).not.toThrow();
		expect(() => renderMarkdown("---", -4)).not.toThrow();
		expect(renderMarkdown("---", 0)).toBe("");
		expect(renderMarkdown("---", -4)).toBe("");
	});
});
