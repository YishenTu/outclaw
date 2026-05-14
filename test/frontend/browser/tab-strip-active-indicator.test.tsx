import { beforeEach, describe, expect, test } from "bun:test";
import { ACTIVE_TAB_UNDERLINE_CLASS } from "../../../src/frontend/browser/components/active-tab-underline.tsx";
import {
	TabBar,
	TabBarView,
} from "../../../src/frontend/browser/components/center/tab-bar.tsx";
import { RightPanelUpperTabs } from "../../../src/frontend/browser/components/right-panel/right-panel.tsx";
import {
	RunCommandMenu,
	TerminalTabs,
} from "../../../src/frontend/browser/components/right-panel/terminal/terminal-tabs.tsx";
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

	test("center close buttons do not reserve tab width while hidden", () => {
		const html = renderToStaticMarkup(
			<TabBarView
				activeTabId="agent-a:notes/very-long-file-name.md"
				closeTab={() => {}}
				setActiveTab={() => {}}
				tabs={[
					{ type: "chat", id: "chat" },
					{
						type: "file",
						id: "agent-a:notes/very-long-file-name.md",
						agentId: "agent-a",
						path: "notes/very-long-file-name.md",
					},
				]}
			/>,
		);

		expect(html).toContain("invisible");
		expect(html).toContain(">very-long-file-name.md</span>");
		expect(html).not.toContain(">notes/very-long-file-name.md</span>");
		expect(html).toContain("absolute right-1");
		expect(html).toContain("group-hover:pr-6");
		expect(html).toContain('aria-label="Close notes/very-long-file-name.md"');
	});

	test("center git diff tabs display file names instead of relative paths", () => {
		const html = renderToStaticMarkup(
			<TabBarView
				activeTabId="git-diff:agents/john-doe/AGENTS.md"
				closeTab={() => {}}
				setActiveTab={() => {}}
				tabs={[
					{ type: "chat", id: "chat" },
					{
						type: "git-diff",
						id: "git-diff:agents/john-doe/AGENTS.md",
						path: "agents/john-doe/AGENTS.md",
					},
				]}
			/>,
		);

		expect(html).toContain(">AGENTS.md</span>");
		expect(html).not.toContain(">agents/john-doe/AGENTS.md</span>");
		expect(html).toContain('aria-label="Close agents/john-doe/AGENTS.md"');
	});

	test("terminal tabs keep the existing underline thickness", () => {
		const html = renderToStaticMarkup(
			<TerminalTabs
				activeTerminalId="terminal-1"
				activeTab="terminal"
				canEditRunCommand={true}
				canRunCommand={true}
				onCloseTerminal={() => {}}
				onCreateTerminal={() => {}}
				onEditRunCommand={() => {}}
				onRenameTerminal={() => {}}
				onRunCommand={() => {}}
				onSelectRun={() => {}}
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

	test("terminal tabs render close controls for a single terminal", () => {
		const html = renderToStaticMarkup(
			<TerminalTabs
				activeTerminalId="terminal-1"
				activeTab="terminal"
				canEditRunCommand={true}
				canRunCommand={true}
				onCloseTerminal={() => {}}
				onCreateTerminal={() => {}}
				onEditRunCommand={() => {}}
				onRenameTerminal={() => {}}
				onRunCommand={() => {}}
				onSelectRun={() => {}}
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

		expect(html).toContain('aria-label="Close Terminal"');
	});

	test("terminal close buttons do not reserve tab width while hidden", () => {
		const html = renderToStaticMarkup(
			<TerminalTabs
				activeTerminalId="terminal-1"
				activeTab="terminal"
				canEditRunCommand={true}
				canRunCommand={true}
				onCloseTerminal={() => {}}
				onCreateTerminal={() => {}}
				onEditRunCommand={() => {}}
				onRenameTerminal={() => {}}
				onRunCommand={() => {}}
				onSelectRun={() => {}}
				onSelectTerminal={() => {}}
				terminals={[
					{
						agentId: "agent-a",
						id: "terminal-1",
						name: "Build Shell",
						createdAt: 1,
					},
				]}
			/>,
		);

		expect(html).toContain("invisible");
		expect(html).toContain("absolute right-0");
		expect(html).toContain("group-hover:pr-5");
		expect(html).toContain('aria-label="Close Build Shell"');
	});

	test("terminal tabs render a fixed run tab and header run button", () => {
		const html = renderToStaticMarkup(
			<TerminalTabs
				activeTerminalId="terminal-1"
				activeTab="run"
				canEditRunCommand={true}
				canRunCommand={true}
				onCloseTerminal={() => {}}
				onCreateTerminal={() => {}}
				onEditRunCommand={() => {}}
				onRenameTerminal={() => {}}
				onRunCommand={() => {}}
				onSelectRun={() => {}}
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

		expect(html).toContain(">Run</button>");
		expect(html).toContain('aria-label="Select run tab"');
		expect(html).toContain("relative flex shrink-0");
		expect(html).toContain("h-full min-w-0 font-mono-ui");
		expect(html).toContain('aria-label="Run command"');
		expect(html).toContain('aria-label="Open run command menu"');
		expect(html).toContain("lucide-chevron-down");
		expect(html).toContain('aria-expanded="false"');
		expect(html).toContain("font-mono-ui flex h-6");
		expect(html).toContain("text-[11px] uppercase tracking-[0.12em]");
		expect(html).toContain("rounded border border-dark-800");
		expect(html).not.toContain("⌘R");
		expect(html).toContain("h-0.5 bg-brand");
	});

	test("terminal run command menu exposes edit as the first action", () => {
		const html = renderToStaticMarkup(
			<RunCommandMenu canEditRunCommand={true} onEditRunCommand={() => {}} />,
		);

		expect(html).toContain('role="menu"');
		expect(html).toContain('aria-label="Run command menu"');
		expect(html).toContain('role="menuitem"');
		expect(html).toContain('aria-label="Edit run command"');
		expect(html).toContain("Edit command");
		expect(html).toContain("lucide-pencil");
	});

	test("terminal tabs keep space between tab labels", () => {
		const html = renderToStaticMarkup(
			<TerminalTabs
				activeTerminalId="terminal-1"
				activeTab="terminal"
				canEditRunCommand={true}
				canRunCommand={true}
				onCloseTerminal={() => {}}
				onCreateTerminal={() => {}}
				onEditRunCommand={() => {}}
				onRenameTerminal={() => {}}
				onRunCommand={() => {}}
				onSelectRun={() => {}}
				onSelectTerminal={() => {}}
				terminals={[
					{
						agentId: "agent-a",
						id: "terminal-1",
						name: "Terminal",
						createdAt: 1,
					},
					{
						agentId: "agent-a",
						id: "terminal-2",
						name: "Terminal 2",
						createdAt: 2,
					},
				]}
			/>,
		);

		expect(html).toContain("items-stretch gap-3 overflow-x-auto");
	});

	test("right panel upper tabs use the thinner underline", () => {
		const html = renderToStaticMarkup(
			<RightPanelUpperTabs activeTab="files" onSelectTab={() => {}} />,
		);

		expect(html).toContain(ACTIVE_TAB_UNDERLINE_CLASS);
		expect(html).not.toContain("h-0.5 bg-brand");
	});
});
