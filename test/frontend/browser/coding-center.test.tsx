import { describe, expect, test } from "bun:test";
import { CodingSessionView } from "../../../src/frontend/browser/coding/coding-session-view.tsx";
import { CodingTabBar } from "../../../src/frontend/browser/coding/coding-tab-bar.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

describe("browser coding center", () => {
	test("keeps the code-mode tab strip at the same fixed height as chat mode", () => {
		const html = renderToStaticMarkup(
			<CodingTabBar
				tabs={[]}
				activeTabId={undefined}
				onSelect={() => {}}
				onClose={() => {}}
			/>,
		);

		expect(html).toContain(
			'class="flex h-12 shrink-0 items-stretch border-b border-dark-800 bg-dark-950 px-3"',
		);
	});

	test("lets the coding session body take remaining center-panel height", () => {
		const html = renderToStaticMarkup(
			<CodingSessionView
				repository={undefined}
				session={undefined}
				onSessionStarted={() => {}}
			/>,
		);

		expect(html).toContain('class="flex min-h-0 flex-1 flex-col bg-dark-950"');
		expect(html).not.toContain('class="flex h-full flex-col bg-dark-950"');
	});

	test("renders the coding composer as text-only because coding APIs do not accept images", () => {
		const html = renderToStaticMarkup(
			<CodingSessionView
				repository={{
					id: "repo-1",
					rootCwd: "/repo",
					displayName: "outclaw",
					source: "manual",
					status: "active",
					createdAt: 1,
					lastActive: 1,
				}}
				session={undefined}
				onSessionStarted={() => {}}
			/>,
		);

		expect(html).toContain('placeholder="Type a message..."');
		expect(html).not.toContain("paste/drop an image");
	});
});
