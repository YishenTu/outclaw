import { describe, expect, test } from "bun:test";
import { CodePreview } from "../../../src/frontend/browser/components/file-viewer/file-viewer.tsx";
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
