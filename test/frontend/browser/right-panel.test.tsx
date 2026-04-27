import { describe, expect, test } from "bun:test";
import {
	RightPanel,
	RightPanelUpperTabs,
} from "../../../src/frontend/browser/components/right-panel/right-panel.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

describe("RightPanel", () => {
	test("renders files and terminal empty states without an active agent", () => {
		const html = renderToStaticMarkup(<RightPanel onCollapse={() => {}} />);

		expect(html).toContain('aria-label="Collapse right sidebar"');
		expect(html).toContain(">Files<");
		expect(html).toContain("~/.outclaw/agents/");
		expect(html).toContain("No active agent.");
		expect(html).toContain('aria-label="Resize right panel split"');
		expect(html).toContain('aria-label="Collapse terminal panel"');
		expect(html).toContain("Terminal");
	});

	test("renders active cron and git tab states with the collapse affordance", () => {
		const cronHtml = renderToStaticMarkup(
			<RightPanelUpperTabs
				activeTab="cron"
				onCollapse={() => {}}
				onSelectTab={() => {}}
			/>,
		);
		const gitHtml = renderToStaticMarkup(
			<RightPanelUpperTabs activeTab="git" onSelectTab={() => {}} />,
		);

		expect(cronHtml).toContain('aria-label="Collapse right sidebar"');
		expect(cronHtml).toContain(">Cron<");
		expect(cronHtml).toContain("lucide-clock3");
		expect(gitHtml).toContain(">Git<");
		expect(gitHtml).toContain("lucide-git-branch");
	});
});
