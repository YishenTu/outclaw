import { describe, expect, test } from "bun:test";
import { MarkdownContent } from "../../../src/frontend/browser/components/chat/markdown-content.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

describe("MarkdownContent", () => {
	test("removes typography backticks from inline code", () => {
		const html = renderToStaticMarkup(
			<MarkdownContent content={"Use `code` inline"} />,
		);

		expect(html).toContain("[&amp;_code::before]:content-none");
		expect(html).toContain("[&amp;_code::after]:content-none");
	});

	test("applies wrapping classes to code blocks", () => {
		const html = renderToStaticMarkup(
			<MarkdownContent content={"```ts\nconst value = 1;\n```"} />,
		);

		expect(html).toContain("[&amp;_pre]:whitespace-pre-wrap");
		expect(html).toContain("[&amp;_pre]:overflow-x-hidden");
		expect(html).toContain("[&amp;_pre_code]:whitespace-pre-wrap");
	});

	test("highlights fenced code blocks with explicit languages", () => {
		const html = renderToStaticMarkup(
			<MarkdownContent content={"```ts\nconst value = 1;\n```"} />,
		);

		expect(html).toContain("hljs language-ts");
		expect(html).toContain("hljs-keyword");
	});

	test("leaves fenced code blocks without explicit languages unhighlighted", () => {
		const html = renderToStaticMarkup(
			<MarkdownContent content={"```\nconst value = 1;\n```"} />,
		);

		expect(html).not.toContain('class="hljs');
		expect(html).not.toContain("hljs-keyword");
	});

	test("renders inline latex with katex markup", () => {
		const html = renderToStaticMarkup(
			<MarkdownContent content={"Einstein wrote $E = mc^2$."} />,
		);

		expect(html).toContain('class="katex"');
		expect(html).not.toContain("$E = mc^2$");
	});

	test("renders display latex blocks with katex display markup", () => {
		const html = renderToStaticMarkup(
			<MarkdownContent content={"$$\n\\int_0^1 x^2 \\, dx\n$$"} />,
		);

		expect(html).toContain("katex-display");
		expect(html).not.toContain("$$");
	});
});
