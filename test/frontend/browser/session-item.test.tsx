import { describe, expect, test } from "bun:test";
import { SessionItem } from "../../../src/frontend/browser/components/agent-sidebar/session-item.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";
import type { SessionEntry } from "../../../src/frontend/browser/stores/sessions.ts";

const SESSION: SessionEntry = {
	agentId: "agent-railly",
	providerId: "mock",
	sdkSessionId: "sdk-alpha",
	title: "Daily planning",
	model: "mock-model",
	lastActive: Date.now() - 120_000,
};

describe("SessionItem", () => {
	test("renders the session title, delete affordance, and compact activity age", () => {
		const html = renderToStaticMarkup(
			<SessionItem
				session={SESSION}
				isActive={false}
				onSelect={() => {}}
				onRename={() => {}}
				onDelete={() => {}}
			/>,
		);

		expect(html).toContain("Daily planning");
		expect(html).toContain('aria-label="Delete session Daily planning"');
		expect(html).toContain("2m");
		expect(html).toContain("group-hover:block");
		expect(html).toContain("opacity-0");
		expect(html).not.toContain("bg-dark-100");
	});

	test("marks the active session with the active dot", () => {
		const html = renderToStaticMarkup(
			<SessionItem
				session={SESSION}
				isActive={true}
				onSelect={() => {}}
				onRename={() => {}}
				onDelete={() => {}}
			/>,
		);

		expect(html).toContain("bg-dark-100");
		expect(html).not.toContain("opacity-0");
	});
});
