import { describe, expect, test } from "bun:test";
import { RuntimeCommandPopup } from "../../../src/frontend/browser/components/chat/runtime-command-popup.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

describe("RuntimeCommandPopup", () => {
	test("does not render footer hotkey hints for status popups", () => {
		const html = renderToStaticMarkup(
			<RuntimeCommandPopup
				popup={{
					kind: "status",
					text: "Status\nsession: Alpha",
				}}
				selectedIndex={0}
				onSelect={() => {}}
			/>,
		);

		expect(html).not.toContain("Esc dismiss");
		expect(html).not.toContain("Enter select");
	});

	test("renders status popups with the same menu typography as agent and session popups", () => {
		const html = renderToStaticMarkup(
			<RuntimeCommandPopup
				popup={{
					kind: "status",
					text: "Status\nsession: Alpha\nmodel: opus\neffort: high",
				}}
				selectedIndex={0}
				onSelect={() => {}}
			/>,
		);

		expect(html).toContain(
			"border-b border-dark-800 px-3 py-2 text-xs uppercase tracking-[0.14em] text-dark-500",
		);
		expect(html).toContain("px-4 py-3 text-sm text-dark-300");
		expect(html).not.toContain("font-mono-ui whitespace-pre-wrap");
	});

	test("does not render footer hotkey hints for list popups", () => {
		const html = renderToStaticMarkup(
			<RuntimeCommandPopup
				popup={{
					kind: "agent",
					activeAgentId: "agent-alpha",
					activeAgentName: "alpha",
					agents: [
						{ agentId: "agent-alpha", name: "alpha" },
						{ agentId: "agent-beta", name: "beta" },
					],
				}}
				selectedIndex={0}
				onSelect={() => {}}
			/>,
		);

		expect(html).not.toContain("Esc dismiss");
		expect(html).not.toContain("Enter select");
	});
});
