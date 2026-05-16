import { beforeEach, describe, expect, test } from "bun:test";
import { CenterPanelView } from "../../../src/frontend/browser/components/center/center-panel.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";
import type { Tab } from "../../../src/frontend/browser/stores/tabs.ts";
import { useTabsStore } from "../../../src/frontend/browser/stores/tabs.ts";

function resetStore<TState>(store: {
	getInitialState(): TState;
	setState(state: TState, replace: true): void;
}) {
	store.setState(store.getInitialState(), true);
}

describe("browser center panel", () => {
	beforeEach(() => {
		resetStore(useTabsStore);
	});

	test("keeps inactive center tabs mounted while hiding them", () => {
		const tabs: Tab[] = [
			{ type: "chat", id: "chat" },
			{
				type: "file",
				id: "agent-a:AGENTS.md",
				agentId: "agent-a",
				path: "AGENTS.md",
			},
		];

		const html = renderToStaticMarkup(
			<CenterPanelView
				activeTabId="agent-a:AGENTS.md"
				closeTab={() => {}}
				setActiveTab={() => {}}
				tabs={tabs}
			/>,
		);

		expect(html).toContain('data-center-tab-panel="chat"');
		expect(html).toContain('data-center-tab-panel="agent-a:AGENTS.md"');
		expect(html).toContain('aria-hidden="true"');
		expect(html).toContain('aria-hidden="false"');
		expect(html).toContain("No active agent");
		expect(html).toContain("AGENTS.md");
	});

	test("renders linked coding sessions control in the middle-panel header", () => {
		const html = renderToStaticMarkup(
			<CenterPanelView
				activeTabId="chat"
				closeTab={() => {}}
				setActiveTab={() => {}}
				tabs={[{ type: "chat", id: "chat" }]}
			/>,
		);

		const controlIndex = html.indexOf(
			'aria-label="Open linked coding sessions"',
		);
		const panelIndex = html.indexOf('data-center-tab-panel="chat"');

		expect(controlIndex).toBeGreaterThan(-1);
		expect(panelIndex).toBeGreaterThan(-1);
		expect(controlIndex).toBeLessThan(panelIndex);
	});
});
