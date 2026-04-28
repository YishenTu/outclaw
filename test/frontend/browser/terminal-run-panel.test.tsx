import { describe, expect, test } from "bun:test";
import { TerminalRunPanel } from "../../../src/frontend/browser/components/right-panel/terminal-run-panel.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

describe("TerminalRunPanel", () => {
	test("asks for command setup before a run command is configured", () => {
		const html = renderToStaticMarkup(
			<TerminalRunPanel
				active={true}
				agentId="agent-a"
				command=""
				draftCommand=""
				error={null}
				executedCommand={null}
				onDraftCommandChange={() => {}}
				onRun={() => {}}
				onSave={() => {}}
				onRunRequestDispatched={() => {}}
				runRequest={null}
				saving={false}
			/>,
		);

		expect(html).toContain("Set up run command");
		expect(html).toContain('placeholder="Command"');
		expect(html).toContain('aria-label="Run command"');
		expect(html).toContain(">Save</button>");
	});

	test("keeps the setup input editable before the command is saved", () => {
		const html = renderToStaticMarkup(
			<TerminalRunPanel
				active={true}
				agentId="agent-a"
				command=""
				draftCommand=""
				error={null}
				executedCommand={null}
				onDraftCommandChange={() => {}}
				onRun={() => {}}
				onSave={() => {}}
				onRunRequestDispatched={() => {}}
				runRequest={null}
				saving={false}
			/>,
		);

		const input = html.match(/<input[^>]*aria-label="Run command"[^>]*>/)?.[0];
		expect(input).toBeDefined();
		expect(input).not.toContain("disabled");
	});

	test("shows a terminal icon and run button when a command is already configured", () => {
		const html = renderToStaticMarkup(
			<TerminalRunPanel
				active={true}
				agentId="agent-a"
				command="bun test"
				draftCommand="bun test"
				error={null}
				executedCommand={null}
				onDraftCommandChange={() => {}}
				onRun={() => {}}
				onSave={() => {}}
				onRunRequestDispatched={() => {}}
				runRequest={null}
				saving={false}
			/>,
		);

		expect(html).toContain('aria-label="Run saved command"');
		expect(html).toContain("lucide-play");
		expect(html).toContain("lucide-square-terminal");
		expect(html).toContain('width="40"');
		const button = html.match(
			/<button[^>]*aria-label="Run saved command"[^>]*>/,
		)?.[0];
		expect(button).toBeDefined();
		expect(button).not.toContain('disabled=""');
		expect(html).not.toContain("Set up run command");
		expect(html).not.toContain('placeholder="Command"');
		expect(html).not.toContain("Saved command");
		expect(html).not.toContain("bun test");
	});

	test("shows setup when the runtime command is empty", () => {
		const html = renderToStaticMarkup(
			<TerminalRunPanel
				active={true}
				agentId="agent-a"
				command=""
				draftCommand=""
				error={null}
				executedCommand={null}
				onDraftCommandChange={() => {}}
				onRun={() => {}}
				onSave={() => {}}
				onRunRequestDispatched={() => {}}
				runRequest={null}
				saving={false}
			/>,
		);

		expect(html).toContain("Set up run command");
		expect(html).toContain('placeholder="Command"');
		expect(html).toContain("lucide-square-terminal");
		expect(html).not.toContain("Loading command");
		expect(html).not.toContain('aria-label="Run saved command"');
	});

	test("renders the run terminal without a subheader after execution", () => {
		const html = renderToStaticMarkup(
			<TerminalRunPanel
				active={true}
				agentId="agent-a"
				command="bun test"
				draftCommand="bun test"
				error={null}
				executedCommand="bun test"
				onDraftCommandChange={() => {}}
				onRun={() => {}}
				onSave={() => {}}
				onRunRequestDispatched={() => {}}
				runRequest={null}
				saving={false}
			/>,
		);

		expect(html).not.toContain("border-b border-dark-900");
		expect(html).not.toContain('aria-label="Run command"');
	});

	test("returns to setup when the command is removed after execution", () => {
		const html = renderToStaticMarkup(
			<TerminalRunPanel
				active={true}
				agentId="agent-a"
				command=""
				draftCommand=""
				error={null}
				executedCommand="bun test"
				onDraftCommandChange={() => {}}
				onRun={() => {}}
				onSave={() => {}}
				onRunRequestDispatched={() => {}}
				runRequest={null}
				saving={false}
			/>,
		);

		expect(html).toContain("Set up run command");
		expect(html).toContain('placeholder="Command"');
		expect(html).not.toContain("browser-terminal-shell");
	});
});
