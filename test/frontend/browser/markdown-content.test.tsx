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

	test("renders a copy button inside fenced code blocks", () => {
		const html = renderToStaticMarkup(
			<MarkdownContent content={"```ts\nconst value = 1;\n```"} />,
		);

		expect(html).toContain('aria-label="Copy code block"');
		expect(html).toContain("absolute right-2 top-2");
		expect(html).not.toContain('title="Copy code"');
		expect(html).not.toContain(">Copy code<");
		expect(html).not.toContain("rounded border");
		expect(html).not.toContain("border-dark-700");
	});

	test("does not add a copy button to inline code", () => {
		const html = renderToStaticMarkup(
			<MarkdownContent content={"Use `code` inline"} />,
		);

		expect(html).not.toContain("Copy code");
		expect(html).not.toContain("Copy code block");
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

	test("styles wikilinks in chat markdown text", () => {
		const html = renderToStaticMarkup(
			<MarkdownContent content={"Check [[project-outclaw]] next."} />,
		);

		expect(html).toContain(
			'<strong class="md-wikilink text-brand font-bold">project-outclaw</strong>',
		);
		expect(html).not.toContain(">[[project-outclaw]]</strong>");
	});

	test("leaves chat inline code wikilinks as plain code text", () => {
		const html = renderToStaticMarkup(
			<MarkdownContent content={"Keep `[[project-outclaw]]` literal."} />,
		);

		expect(html).toContain("<code>[[project-outclaw]]</code>");
		expect(html).not.toContain("md-wikilink");
		expect(html).not.toContain("text-brand");
	});

	describe("intra-word bold adjacent to punctuation", () => {
		test("renders bold when ** sits between word and quoted punctuation", () => {
			const html = renderToStaticMarkup(
				<MarkdownContent content={'word**"x"**'} />,
			);
			expect(html).toContain("<strong>");
			expect(html).toContain("&quot;x&quot;</strong>");
			expect(html).not.toContain("**");
		});

		test('renders bold for the mirror case **"x"**word', () => {
			const html = renderToStaticMarkup(
				<MarkdownContent content={'**"x"**word'} />,
			);
			expect(html).toContain("<strong>&quot;x&quot;</strong>word");
			expect(html).not.toContain("**");
		});

		test("renders bold inside unordered list items", () => {
			const html = renderToStaticMarkup(
				<MarkdownContent content={'- **"first"**word\n- plain'} />,
			);
			expect(html).toContain("<strong>&quot;first&quot;</strong>word");
			expect(html).not.toContain("**");
		});

		test("renders bold inside ordered list items", () => {
			const html = renderToStaticMarkup(
				<MarkdownContent content={'1. **"first"**word\n2. plain'} />,
			);
			expect(html).toContain("<strong>&quot;first&quot;</strong>word");
			expect(html).not.toContain("**");
		});

		test("renders bold for non-quote punctuation adjacencies", () => {
			for (const md of [
				"word**'x'**",
				"word**(x)**",
				"word**[x]**",
				"word**.x.**",
				"word**-x-**",
			]) {
				const html = renderToStaticMarkup(<MarkdownContent content={md} />);
				expect(html).toContain("<strong>");
				expect(html).not.toContain("**");
			}
		});

		test("does not bold ** inside inline code", () => {
			const html = renderToStaticMarkup(
				<MarkdownContent content={'`**"x"**`'} />,
			);
			expect(html).toContain("<code>**&quot;x&quot;**</code>");
		});

		test("does not bold ** inside fenced code blocks", () => {
			const html = renderToStaticMarkup(
				<MarkdownContent content={'```\n**"x"**\n```'} />,
			);
			expect(html).toContain("**&quot;x&quot;**");
			expect(html).not.toContain("<strong>");
		});

		test("leaves underscore intra-word unchanged to preserve identifiers", () => {
			const html = renderToStaticMarkup(
				<MarkdownContent content={"snake_case_var"} />,
			);
			expect(html).toContain("snake_case_var");
			expect(html).not.toContain("<strong>");
			expect(html).not.toContain("<em>");
		});

		test("leaves unmatched ** as literal", () => {
			const html = renderToStaticMarkup(
				<MarkdownContent content={"foo **bar"} />,
			);
			expect(html).toContain("foo **bar");
			expect(html).not.toContain("<strong>");
		});
	});
});
