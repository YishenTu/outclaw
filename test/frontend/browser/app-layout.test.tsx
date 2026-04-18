import { beforeEach, describe, expect, test } from "bun:test";
import { AppLayoutView } from "../../../src/frontend/browser/layouts/app-layout-view.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";
import { useAgentsStore } from "../../../src/frontend/browser/stores/agents.ts";

function resetStore<TState>(store: {
	getInitialState(): TState;
	setState(state: TState, replace: true): void;
}) {
	store.setState(store.getInitialState(), true);
}

describe("browser app layout", () => {
	beforeEach(() => {
		resetStore(useAgentsStore);
	});

	test("shows the welcome page before the workspace is opened", () => {
		useAgentsStore
			.getState()
			.setAgents([{ agentId: "agent-a", name: "alpha" }]);

		const html = renderToStaticMarkup(
			<AppLayoutView
				inspectorWidth={420}
				leftCollapsed={false}
				onCollapseLeft={undefined}
				onCollapseRight={() => {}}
				onExpandLeft={() => {}}
				onExpandRight={() => {}}
				onLeftResizeMouseDown={() => {}}
				onRightResizeMouseDown={() => {}}
				resizingSide={null}
				rightCollapsed={false}
				showWelcomePage={true}
				sidebarWidth={260}
			/>,
		);

		expect(html).toContain('aria-label="Welcome page"');
		expect(html).not.toContain('aria-label="Collapse right sidebar"');
	});

	test("restores the left sidebar while the welcome page is visible", () => {
		const html = renderToStaticMarkup(
			<AppLayoutView
				inspectorWidth={420}
				leftCollapsed={true}
				onCollapseLeft={undefined}
				onCollapseRight={() => {}}
				onExpandLeft={() => {}}
				onExpandRight={() => {}}
				onLeftResizeMouseDown={() => {}}
				onRightResizeMouseDown={() => {}}
				resizingSide={null}
				rightCollapsed={false}
				showWelcomePage={true}
				sidebarWidth={260}
			/>,
		);

		expect(html).toContain("Agents and sessions");
		expect(html).toContain('aria-label="Resize left sidebar"');
	});

	test("renders the full workspace after the browser enters workspace mode", () => {
		const html = renderToStaticMarkup(
			<AppLayoutView
				inspectorWidth={420}
				leftCollapsed={false}
				onCollapseLeft={() => {}}
				onCollapseRight={() => {}}
				onExpandLeft={() => {}}
				onExpandRight={() => {}}
				onLeftResizeMouseDown={() => {}}
				onRightResizeMouseDown={() => {}}
				resizingSide={null}
				rightCollapsed={false}
				showWelcomePage={false}
				sidebarWidth={260}
			/>,
		);

		expect(html).not.toContain('aria-label="Welcome page"');
		expect(html).toContain('aria-label="Collapse right sidebar"');
	});
});
