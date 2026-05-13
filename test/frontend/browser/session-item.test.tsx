import { describe, expect, test } from "bun:test";
import { SessionItem } from "../../../src/frontend/browser/components/agent-sidebar/session-item.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

const SESSION = {
	title: "Daily planning",
	lastActive: Date.now() - 120_000,
};

function buttonOpeningTagWithLabel(html: string, label: string): string {
	const labelIndex = html.indexOf(`aria-label="${label}"`);
	expect(labelIndex).toBeGreaterThan(-1);
	const buttonStart = html.lastIndexOf("<button", labelIndex);
	const buttonEnd = html.indexOf(">", labelIndex);
	expect(buttonStart).toBeGreaterThan(-1);
	expect(buttonEnd).toBeGreaterThan(labelIndex);
	return html.slice(buttonStart, buttonEnd);
}

describe("SessionItem", () => {
	test("renders the session title, delete affordance, and compact activity age", () => {
		const html = renderToStaticMarkup(
			<SessionItem
				title={SESSION.title}
				lastActive={SESSION.lastActive}
				isActive={false}
				onSelect={() => {}}
				onRename={() => {}}
				onDelete={() => {}}
			/>,
		);

		expect(html).toContain("Daily planning");
		expect(html).toContain('aria-label="Delete session Daily planning"');
		expect(html).toContain("2m");
		expect(html).toContain("group-hover:flex");
		expect(html).toContain("opacity-0");
		expect(html).not.toContain("bg-dark-100");
	});

	test("marks the active session with the active dot", () => {
		const html = renderToStaticMarkup(
			<SessionItem
				title={SESSION.title}
				lastActive={SESSION.lastActive}
				isActive={true}
				onSelect={() => {}}
				onRename={() => {}}
				onDelete={() => {}}
			/>,
		);

		expect(html).toContain("bg-dark-100");
		expect(html).not.toContain("opacity-0");
	});

	test("marks only confirmed actions as dialog triggers", () => {
		const confirmedHtml = renderToStaticMarkup(
			<SessionItem
				title={SESSION.title}
				lastActive={SESSION.lastActive}
				isActive={false}
				onSelect={() => {}}
				onRename={() => {}}
				onDelete={() => {}}
			/>,
		);
		const immediateHtml = renderToStaticMarkup(
			<SessionItem
				title={SESSION.title}
				lastActive={SESSION.lastActive}
				isActive={false}
				onSelect={() => {}}
				onRename={() => {}}
				onDelete={() => {}}
				actionAriaLabel="Restore session Daily planning"
				actionLabel="Restore"
				actionRequiresConfirmation={false}
			/>,
		);

		expect(
			buttonOpeningTagWithLabel(confirmedHtml, "Delete session Daily planning"),
		).toContain('aria-haspopup="dialog"');
		expect(
			buttonOpeningTagWithLabel(
				immediateHtml,
				"Restore session Daily planning",
			),
		).not.toContain('aria-haspopup="dialog"');
	});
});
