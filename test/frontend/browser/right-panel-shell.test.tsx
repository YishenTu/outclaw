import { describe, expect, test } from "bun:test";
import {
	RightPanelSplitShell,
	RightPanelTabBar,
} from "../../../src/frontend/browser/components/right-panel/right-panel-shell.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

describe("right panel shell", () => {
	test("renders reusable right-panel upper tabs", () => {
		const html = renderToStaticMarkup(
			<RightPanelTabBar
				activeTab="files"
				tabs={[
					{
						id: "files",
						label: "Files",
						icon: <span aria-hidden="true">F</span>,
					},
				]}
				onCollapse={() => {}}
				onSelectTab={() => {}}
			/>,
		);

		expect(html).toContain('aria-label="Collapse right sidebar"');
		expect(html).toContain(">Files<");
		expect(html).toContain('aria-hidden="true"');
	});

	test("renders reusable upper/lower split chrome", () => {
		const html = renderToStaticMarkup(
			<RightPanelSplitShell
				upperHeight="60%"
				lowerHeight="40%"
				lowerCollapsed={false}
				isResizing={false}
				onResizeMouseDown={() => {}}
				onExpandLower={() => {}}
				upperContent={<div>Files pane</div>}
				lowerHeader={<div>Terminal header</div>}
				lowerContent={<div>Terminal body</div>}
			/>,
		);

		expect(html).toContain('aria-label="Resize right panel split"');
		expect(html).toContain("Files pane");
		expect(html).toContain("Terminal header");
		expect(html).toContain("Terminal body");
	});
});
