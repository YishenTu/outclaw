import { describe, expect, test } from "bun:test";
import { ThinkingContent } from "../../../src/frontend/browser/components/transcript/thinking-block.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

describe("ThinkingContent", () => {
	test("hides the GPT-5.6 reasoning summary placeholder", () => {
		const html = renderToStaticMarkup(
			<ThinkingContent
				content={"**Inspecting peer and current workspaces**\n\n<!-- -->"}
			/>,
		);

		expect(html).toContain("Inspecting peer and current workspaces");
		expect(html).not.toContain("&lt;!-- --&gt;");
		expect(html).not.toContain("<!-- -->");
	});

	test("preserves non-placeholder HTML comments", () => {
		const content = "Before <!-- keep this context --> after";
		const html = renderToStaticMarkup(<ThinkingContent content={content} />);

		expect(html).toContain("Before");
		expect(html).toContain("after");
	});
});
