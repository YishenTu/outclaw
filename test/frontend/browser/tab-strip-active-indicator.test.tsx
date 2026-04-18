import { beforeEach, describe, expect, test } from "bun:test";
import { ACTIVE_TAB_UNDERLINE_CLASS } from "../../../src/frontend/browser/components/active-tab-underline.tsx";
import { TabBar } from "../../../src/frontend/browser/components/center/tab-bar.tsx";
import { RightPanelUpperTabs } from "../../../src/frontend/browser/components/right-panel/right-panel.tsx";
import { TerminalTabs } from "../../../src/frontend/browser/components/right-panel/terminal-tabs.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";
import { useTabsStore } from "../../../src/frontend/browser/stores/tabs.ts";

function resetStore<TState>(store: {
	getInitialState(): TState;
	setState(state: TState, replace: true): void;
}) {
	store.setState(store.getInitialState(), true);
}

describe("browser tab strip active indicator", () => {
	beforeEach(() => {
		resetStore(useTabsStore);
	});

	test("center tabs keep the existing underline thickness", () => {
		useTabsStore.getState().openTab({
			type: "file",
			id: "agent-a:AGENTS.md",
			agentId: "agent-a",
			path: "AGENTS.md",
		});

		const html = renderToStaticMarkup(<TabBar />);

		expect(html).toContain("h-0.5 bg-brand");
		expect(html).not.toContain(ACTIVE_TAB_UNDERLINE_CLASS);
	});

	test("terminal tabs keep the existing underline thickness", () => {
		const html = renderToStaticMarkup(
			<TerminalTabs
				activeTerminalId="terminal-1"
				canCloseTerminals={false}
				onCloseTerminal={() => {}}
				onCreateTerminal={() => {}}
				onRenameTerminal={() => {}}
				onSelectTerminal={() => {}}
				terminals={[
					{
						agentId: "agent-a",
						id: "terminal-1",
						name: "Terminal",
						createdAt: 1,
					},
				]}
			/>,
		);

		expect(html).toContain("h-0.5 bg-brand");
		expect(html).not.toContain(ACTIVE_TAB_UNDERLINE_CLASS);
	});

	test("right panel upper tabs use the thinner underline", () => {
		const html = renderToStaticMarkup(
			<RightPanelUpperTabs activeTab="files" onSelectTab={() => {}} />,
		);

		expect(html).toContain(ACTIVE_TAB_UNDERLINE_CLASS);
		expect(html).not.toContain("h-0.5 bg-brand");
	});
});
