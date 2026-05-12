import { describe, expect, test } from "bun:test";
import { BrowserTabStrip } from "../../../src/frontend/browser/components/browser-tab-strip.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

describe("BrowserTabStrip", () => {
	test("renders the shared tab shell with optional add and sidebar controls", () => {
		const html = renderToStaticMarkup(
			<BrowserTabStrip
				items={[
					{
						id: "chat",
						value: "chat",
						title: "Chat",
						icon: <span aria-hidden="true">C</span>,
					},
				]}
				activeId="chat"
				leftCollapsed
				onExpandLeft={() => {}}
				onSelect={() => {}}
				addButton={{
					ariaLabel: "New tab",
					title: "New tab",
					onClick: () => {},
				}}
			/>,
		);

		expect(html).toContain("Expand left sidebar");
		expect(html).toContain("New tab");
		expect(html).toContain(">Chat<");
		expect(html).toContain("bg-brand");
	});
});
