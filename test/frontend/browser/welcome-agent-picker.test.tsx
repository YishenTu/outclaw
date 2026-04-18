import { describe, expect, test } from "bun:test";
import { WelcomeAgentPickerView } from "../../../src/frontend/browser/components/welcome-agent-picker.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

describe("WelcomeAgentPicker", () => {
	test("renders a custom trigger instead of the native select element", () => {
		const html = renderToStaticMarkup(
			<WelcomeAgentPickerView
				agents={[
					{ agentId: "agent-alpha", name: "alpha" },
					{ agentId: "agent-beta", name: "beta" },
				]}
				menuOpen={false}
				onAgentChange={() => {}}
				selectedAgentId="agent-beta"
			/>,
		);

		expect(html).toContain('aria-label="Choose agent"');
		expect(html).toContain(">@beta<");
		expect(html).not.toContain("<select");
	});

	test("renders the available agents inside the custom menu", () => {
		const html = renderToStaticMarkup(
			<WelcomeAgentPickerView
				agents={[
					{ agentId: "agent-alpha", name: "alpha" },
					{ agentId: "agent-beta", name: "beta" },
				]}
				menuOpen={true}
				onAgentChange={() => {}}
				selectedAgentId="agent-beta"
			/>,
		);

		expect(html).toContain(">@alpha<");
		expect(html).toContain(">@beta<");
		expect(html).toContain('aria-label="Choose agent"');
	});

	test("renders a disabled empty state when no agents are available", () => {
		const html = renderToStaticMarkup(
			<WelcomeAgentPickerView
				agents={[]}
				menuOpen={false}
				onAgentChange={() => {}}
				selectedAgentId={null}
			/>,
		);

		expect(html).toContain(">No agents available<");
		expect(html).toContain('disabled=""');
	});
});
