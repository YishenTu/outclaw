import { describe, expect, test } from "bun:test";
import { MarkdownContent } from "../../../src/frontend/browser/components/chat/markdown-content.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

describe("MarkdownContent", () => {
	test("applies wrapping classes to code blocks", () => {
		const html = renderToStaticMarkup(
			<MarkdownContent content={"```ts\nconst value = 1;\n```"} />,
		);

		expect(html).toContain("[&amp;_pre]:whitespace-pre-wrap");
		expect(html).toContain("[&amp;_pre]:overflow-x-hidden");
		expect(html).toContain("[&amp;_pre_code]:whitespace-pre-wrap");
	});
});
