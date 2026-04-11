import { describe, expect, test } from "bun:test";
import {
	markdownToTelegramHtml,
	splitTelegramHtml,
} from "../../../src/frontend/telegram/format.ts";

describe("markdownToTelegramHtml", () => {
	test("escapes HTML entities in plain text", () => {
		expect(markdownToTelegramHtml("a < b & c > d")).toBe(
			"a &lt; b &amp; c &gt; d",
		);
	});

	test("renders bold", () => {
		expect(markdownToTelegramHtml("**bold**")).toBe("<b>bold</b>");
	});

	test("renders italic", () => {
		expect(markdownToTelegramHtml("*italic*")).toBe("<i>italic</i>");
	});

	test("renders strikethrough", () => {
		expect(markdownToTelegramHtml("~~strike~~")).toBe("<s>strike</s>");
	});

	test("renders inline code", () => {
		expect(markdownToTelegramHtml("`code`")).toBe("<code>code</code>");
	});

	test("escapes HTML inside inline code", () => {
		expect(markdownToTelegramHtml("`<div>`")).toBe("<code>&lt;div&gt;</code>");
	});

	test("renders fenced code blocks", () => {
		const md = "```\nconst x = 1;\n```";
		expect(markdownToTelegramHtml(md)).toBe(
			"<pre><code>const x = 1;</code></pre>",
		);
	});

	test("renders fenced code blocks with language", () => {
		const md = "```ts\nconst x = 1;\n```";
		expect(markdownToTelegramHtml(md)).toBe(
			'<pre><code class="language-ts">const x = 1;</code></pre>',
		);
	});

	test("preserves HTML entities in code blocks", () => {
		const md = "```\nif (a < b && c > d) {}\n```";
		expect(markdownToTelegramHtml(md)).toBe(
			"<pre><code>if (a &lt; b &amp;&amp; c &gt; d) {}</code></pre>",
		);
	});

	test("renders links", () => {
		expect(markdownToTelegramHtml("[click](https://example.com)")).toBe(
			'<a href="https://example.com">click</a>',
		);
	});

	test("escapes HTML in link href", () => {
		expect(markdownToTelegramHtml("[x](https://a.com?a=1&b=2)")).toBe(
			'<a href="https://a.com?a=1&amp;b=2">x</a>',
		);
	});

	test("renders headings as bold", () => {
		expect(markdownToTelegramHtml("# Title")).toBe("<b>Title</b>");
	});

	test("renders h2 and h3 as bold", () => {
		expect(markdownToTelegramHtml("## Subtitle")).toBe("<b>Subtitle</b>");
		expect(markdownToTelegramHtml("### H3")).toBe("<b>H3</b>");
	});

	test("renders unordered lists", () => {
		const md = "- one\n- two\n- three";
		expect(markdownToTelegramHtml(md)).toBe(
			"\u2022 one\n\u2022 two\n\u2022 three",
		);
	});

	test("renders ordered lists", () => {
		const md = "1. one\n2. two\n3. three";
		expect(markdownToTelegramHtml(md)).toBe("1. one\n2. two\n3. three");
	});

	test("preserves ordered list start number", () => {
		expect(markdownToTelegramHtml("3. three\n4. four")).toBe(
			"3. three\n4. four",
		);
	});

	test("does not double-escape HTML entities", () => {
		expect(markdownToTelegramHtml("a &amp; b")).toBe("a &amp; b");
		expect(markdownToTelegramHtml("a &lt; b")).toBe("a &lt; b");
		expect(markdownToTelegramHtml("a & b")).toBe("a &amp; b");
	});

	test("renders blockquotes", () => {
		expect(markdownToTelegramHtml("> quoted")).toBe(
			"<blockquote>quoted</blockquote>",
		);
	});

	test("renders horizontal rules", () => {
		expect(markdownToTelegramHtml("---")).toBe("\u2500\u2500\u2500");
	});

	test("renders nested formatting", () => {
		expect(markdownToTelegramHtml("**bold *and italic***")).toBe(
			"<b>bold <i>and italic</i></b>",
		);
	});

	test("renders multi-paragraph text", () => {
		const md = "First paragraph.\n\nSecond paragraph.";
		expect(markdownToTelegramHtml(md)).toBe(
			"First paragraph.\n\nSecond paragraph.",
		);
	});

	test("renders mixed content", () => {
		const md = "Hello **world**\n\n- item `one`\n- item *two*";
		expect(markdownToTelegramHtml(md)).toBe(
			"Hello <b>world</b>\n\n\u2022 item <code>one</code>\n\u2022 item <i>two</i>",
		);
	});

	test("renders tables as labeled rows", () => {
		const md = "| Name | Age |\n|------|-----|\n| Alice | 30 |\n| Bob | 25 |";
		expect(markdownToTelegramHtml(md)).toBe(
			"<b>Name</b>: Alice | <b>Age</b>: 30\n<b>Name</b>: Bob | <b>Age</b>: 25",
		);
	});

	test("escapes quotes in link href", () => {
		expect(markdownToTelegramHtml('[x](https://a.com?q="foo")')).toBe(
			'<a href="https://a.com?q=&quot;foo&quot;">x</a>',
		);
	});

	test("escapes quotes in code block language", () => {
		const md = '```ts"injected\ncode\n```';
		expect(markdownToTelegramHtml(md)).toContain(
			'class="language-ts&quot;injected"',
		);
	});

	test("escapes image alt text", () => {
		expect(markdownToTelegramHtml("![<b>](http://x.com/a.png)")).toBe(
			"&lt;b&gt;",
		);
		expect(markdownToTelegramHtml("![a & b](http://x.com/a.png)")).toBe(
			"a &amp; b",
		);
	});

	test("renders task list checkboxes", () => {
		const md = "- [x] done\n- [ ] todo";
		const html = markdownToTelegramHtml(md);
		expect(html).toContain("\u2611 done");
		expect(html).toContain("\u2610 todo");
	});

	test("renders nested lists with indentation", () => {
		const md = "- outer\n  - inner\n  - inner2\n- outer2";
		expect(markdownToTelegramHtml(md)).toBe(
			"\u2022 outer\n  \u2022 inner\n  \u2022 inner2\n\u2022 outer2",
		);
	});

	test("returns empty string for empty input", () => {
		expect(markdownToTelegramHtml("")).toBe("");
	});
});

describe("splitTelegramHtml", () => {
	test("returns single chunk for short text", () => {
		const chunks = splitTelegramHtml("hello", 4096);
		expect(chunks).toEqual(["hello"]);
	});

	test("splits long text at paragraph boundaries", () => {
		const para = "x".repeat(2000);
		const html = `${para}\n\n${para}\n\n${para}`;
		const chunks = splitTelegramHtml(html, 4096);
		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			expect(chunk.length).toBeLessThanOrEqual(4096);
		}
	});

	test("splits at newline when no paragraph boundary fits", () => {
		const line = "y".repeat(100);
		const lines = Array.from({ length: 50 }, () => line);
		const html = lines.join("\n");
		const chunks = splitTelegramHtml(html, 4096);
		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			expect(chunk.length).toBeLessThanOrEqual(4096);
		}
	});

	test("hard-splits when no break point exists", () => {
		const html = "z".repeat(5000);
		const chunks = splitTelegramHtml(html, 4096);
		expect(chunks.length).toBe(2);
		for (const chunk of chunks) {
			expect(chunk.length).toBeLessThanOrEqual(4096);
		}
	});

	test("returns empty array for empty input", () => {
		expect(splitTelegramHtml("", 4096)).toEqual([]);
	});

	test("does not split inside HTML tags", () => {
		// Place a <b> tag right at the split boundary
		const before = "a".repeat(90);
		const html = `${before}<b>bold text</b>`;
		const chunks = splitTelegramHtml(html, 95);
		// First chunk must not contain a partial tag
		expect(chunks[0]).not.toMatch(/<[^>]*$/);
		expect(chunks.at(-1)).not.toMatch(/^[^<]*>/);
	});

	test("does not split inside HTML entities", () => {
		const before = "a".repeat(90);
		const html = `${before}&amp;after`;
		const chunks = splitTelegramHtml(html, 93);
		// No chunk should contain a partial entity
		for (const chunk of chunks) {
			// Check: no '&' without a matching ';' in the last few chars
			const lastAmp = chunk.lastIndexOf("&");
			if (lastAmp >= 0) {
				const hasSemi = chunk.indexOf(";", lastAmp);
				expect(hasSemi).toBeGreaterThan(lastAmp);
			}
		}
	});

	test("keeps chunks within limit when tags add overhead", () => {
		// A code block near the limit: <pre><code>...</code></pre> adds 24 chars
		const code = "a".repeat(4085);
		const html = `<pre><code>${code}</code></pre>`;
		const chunks = splitTelegramHtml(html, 4096);
		for (const chunk of chunks) {
			expect(chunk.length).toBeLessThanOrEqual(4096);
		}
	});

	test("re-opens tags across chunk boundaries", () => {
		const inner = "x".repeat(50);
		const html = `<b>${inner}\n\n${inner}</b>`;
		const chunks = splitTelegramHtml(html, 60);
		expect(chunks.length).toBeGreaterThan(1);
		// First chunk closes the bold tag
		expect(chunks[0]).toContain("</b>");
		// Second chunk re-opens it
		expect(chunks.at(-1)).toMatch(/^<b>/);
	});
});
