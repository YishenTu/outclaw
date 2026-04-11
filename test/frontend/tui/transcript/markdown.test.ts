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

	test("preserves content inside an unclosed code fence", () => {
		const md = "```python\nprint('hello')";
		const result = renderMarkdown(md, 80);
		expect(result).toContain("print");
	});

	test("renders a lone triple backtick without losing surrounding text", () => {
		const md = "before\n```\ncode line";
		const result = renderMarkdown(md, 80);
		expect(result).toContain("before");
		expect(result).toContain("code line");
	});

	test("strips ANSI escape sequences from input", () => {
		const md = "hello \u001b[31mred\u001b[0m world";
		const result = renderMarkdown(md, 80);
		expect(result).toContain("hello");
		expect(result).toContain("red");
		expect(result).toContain("world");
		expect(result).not.toContain("\u001b[31m");
		expect(result).not.toContain("\u001b[0m");
	});

	test("strips C0 control characters but keeps newlines and tabs", () => {
		const md = "bell\u0007 and null\u0000 here";
		const result = renderMarkdown(md, 80);
		expect(result).toContain("bell");
		expect(result).toContain("here");
		expect(result).not.toContain("\u0007");
		expect(result).not.toContain("\u0000");
	});

	test("preserves tabs and newlines", () => {
		const md = "line1\n\tindented";
		const result = renderMarkdown(md, 80);
		expect(result).toContain("line1");
		expect(result).toContain("indented");
	});
});
