import { describe, expect, test } from "bun:test";
import {
	CodePreview,
	FileViewer,
	MarkdownPreview,
} from "../../../src/frontend/browser/components/file-viewer/file-viewer.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

describe("CodePreview", () => {
	test("renders YAML with syntax highlighting", () => {
		const html = renderToStaticMarkup(
			<CodePreview content={"name: Daily\nenabled: true\n"} language="yaml" />,
		);

		expect(html).toContain("language-yaml");
		expect(html).toContain("hljs-attr");
		expect(html).toContain("hljs-literal");
	});

	test("escapes content when no supported language is provided", () => {
		const html = renderToStaticMarkup(
			<CodePreview
				content={"<script>alert('x')</script>"}
				language={undefined}
			/>,
		);

		expect(html).toContain("&lt;script&gt;");
		expect(html).not.toContain("<script>");
	});
});

describe("MarkdownPreview", () => {
	test("renders HTML comments as visible comment annotations", () => {
		const html = renderToStaticMarkup(
			<MarkdownPreview
				content={"# Title\n\n<!-- hint for editors -->\n\nBody\n"}
			/>,
		);

		expect(html).toContain("md-comment");
		expect(html).toContain("hint for editors");
		expect(html).toContain("<h1>Title</h1>");
		expect(html).toContain("Body");
	});

	test("renders multi-line HTML comments preserving trimmed content", () => {
		const html = renderToStaticMarkup(
			<MarkdownPreview content={"<!-- line one\nline two -->\n\nafter\n"} />,
		);

		expect(html).toContain("md-comment");
		expect(html).toContain("line one");
		expect(html).toContain("line two");
	});

	test("renders ordinary markdown without introducing comment markers", () => {
		const html = renderToStaticMarkup(
			<MarkdownPreview content={"Just a paragraph.\n"} />,
		);

		expect(html).not.toContain("md-comment");
		expect(html).toContain("Just a paragraph.");
	});

	test("renders leading frontmatter as YAML preview before markdown body", () => {
		const html = renderToStaticMarkup(
			<MarkdownPreview
				content={
					"---\nname: daily-brief\nkind: topic\nlast_observation_at: 2026-04-21\nlast_synthesized: 2026-04-20\n---\n\n# Model\n\n## What\n\nBody\n"
				}
			/>,
		);

		expect(html).toContain("language-yaml");
		expect(html).toContain("daily-brief");
		expect(html).toContain("<hr");
		expect(html).toContain("<h1>Model</h1>");
		expect(html).toContain("<h2>What</h2>");
		expect(html).toContain("Body");
		expect(html).not.toContain("Frontmatter");
	});

	test("wraps fenced code blocks without horizontal scrolling", () => {
		const html = renderToStaticMarkup(
			<MarkdownPreview
				content={"```ts\nconst value = '0123456789'.repeat(40);\n```"}
			/>,
		);

		expect(html).toContain("[&amp;_pre]:overflow-x-hidden");
		expect(html).toContain("[&amp;_pre]:whitespace-pre-wrap");
		expect(html).toContain("[&amp;_pre]:[overflow-wrap:anywhere]");
		expect(html).toContain("[&amp;_pre_code]:whitespace-pre-wrap");
	});

	test("removes typography backticks from inline code", () => {
		const html = renderToStaticMarkup(
			<MarkdownPreview content={"Use `code` inline"} />,
		);

		expect(html).toContain("[&amp;_code::before]:content-none");
		expect(html).toContain("[&amp;_code::after]:content-none");
	});
});

describe("FileViewer", () => {
	test("does not render a manual refresh button in the preview header", () => {
		const html = renderToStaticMarkup(
			<FileViewer
				tabId="agent-a:AGENTS.md"
				path="AGENTS.md"
				agentId="agent-a"
			/>,
		);

		expect(html).toContain("AGENTS.md");
		expect(html).not.toContain("Refresh");
	});
});
