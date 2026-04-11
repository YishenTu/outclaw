import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "../../../../src/frontend/tui/transcript/markdown.ts";

describe("renderMarkdown", () => {
	test("handles non-positive widths for horizontal rules", () => {
		expect(() => renderMarkdown("---", 0)).not.toThrow();
		expect(() => renderMarkdown("---", -4)).not.toThrow();
		expect(renderMarkdown("---", 0)).toBe("");
		expect(renderMarkdown("---", -4)).toBe("");
	});

	test("renders bold inside ordered list items", () => {
		const md = "1. **Bash** — run a command\n2. **Write** — create a file";
		const result = renderMarkdown(md, 80);
		expect(result).not.toContain("**Bash**");
		expect(result).not.toContain("**Write**");
	});

	test("renders code inside ordered list items", () => {
		const md = "1. Use `gh api` to fetch";
		const result = renderMarkdown(md, 80);
		expect(result).not.toContain("`gh api`");
	});
});
