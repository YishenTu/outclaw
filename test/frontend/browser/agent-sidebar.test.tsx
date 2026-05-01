import { describe, expect, test } from "bun:test";
import { AgentSidebar } from "../../../src/frontend/browser/components/agent-sidebar/agent-sidebar.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

describe("AgentSidebar", () => {
	test("hides the visual scrollbar on the scrollable agent list", () => {
		const html = renderToStaticMarkup(<AgentSidebar />);

		expect(html).toContain("scrollbar-none flex-1 overflow-y-auto");
		expect(html).toContain("Waiting for agent list from the runtime.");
	});
});
