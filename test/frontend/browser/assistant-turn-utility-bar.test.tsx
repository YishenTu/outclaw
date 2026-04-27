import { describe, expect, test } from "bun:test";
import { AssistantTurnCopyButton } from "../../../src/frontend/browser/components/chat/assistant-turn-utility-bar.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

describe("assistant turn utility bar", () => {
	test("renders the default copy state", () => {
		const html = renderToStaticMarkup(
			<AssistantTurnCopyButton
				copied={false}
				disabled={false}
				onClick={() => {}}
			/>,
		);

		expect(html).toContain('aria-label="Copy final result"');
		expect(html).not.toContain(">Copy<");
		expect(html).not.toContain('title="Copy final result"');
		expect(html).not.toContain("rounded border");
		expect(html).not.toContain("border-dark-800");
	});

	test("renders a copied success state", () => {
		const html = renderToStaticMarkup(
			<AssistantTurnCopyButton
				copied={true}
				disabled={false}
				onClick={() => {}}
			/>,
		);

		expect(html).toContain('aria-label="Copied final result"');
		expect(html).not.toContain(">Copied<");
		expect(html).not.toContain('title="Copied"');
		expect(html).not.toContain("rounded border");
		expect(html).not.toContain("border-success/60");
		expect(html).toContain("text-success");
	});

	test("renders a copy failure state", () => {
		const html = renderToStaticMarkup(
			<AssistantTurnCopyButton
				copied={false}
				disabled={false}
				failed={true}
				onClick={() => {}}
			/>,
		);

		expect(html).toContain('aria-label="Copy failed"');
		expect(html).toContain("text-danger");
	});
});
