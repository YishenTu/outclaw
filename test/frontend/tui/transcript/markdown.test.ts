import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "../../../../src/frontend/tui/transcript/markdown.ts";

const ESC = "\x1b";
const ANSI_RE = new RegExp(`${ESC}\\[[0-9;]*[A-Za-z]`, "g");

function stripAnsi(text: string): string {
	return text.replace(ANSI_RE, "");
}

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

	test("renders strong markdown as underline in dim mode", () => {
		const result = renderMarkdown("1. **Bash** and `code`\n# Heading", 80, {
			dim: true,
			colorLevel: 1,
		});
		expect(result).toContain("\u001b[2m");
		expect(result).toContain("\u001b[2m  1.");
		expect(result).toContain("\u001b[4m");
		expect(result).not.toContain("\u001b[1m");
		expect(result).toContain("Heading");
		expect(result).toContain("Bash");
		expect(result).toContain("code");
		expect(result).not.toContain("**Bash**");
		expect(result).not.toContain("`code`");
	});

	test("collapses blank spacer lines inside nested lists", () => {
		const md =
			"1. Create a proper .gitignore that excludes:\n\n   - .env\n   - .DS_Store\n   - db.sqlite\n2. git init";
		const result = stripAnsi(
			renderMarkdown(md, 80, {
				dim: true,
				colorLevel: 1,
			}),
		);
		expect(result).not.toContain("\n     \n");
		expect(result).toContain("    • .env");
		expect(result).toContain("    • .DS_Store");
		expect(result).toContain("    • db.sqlite");
	});
});
