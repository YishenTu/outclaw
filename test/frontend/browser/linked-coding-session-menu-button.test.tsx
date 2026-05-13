import { describe, expect, test } from "bun:test";
import { LinkedCodingSessionMenuButtonView } from "../../../src/frontend/browser/coding/linked-coding-session-menu-button.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

describe("LinkedCodingSessionMenuButtonView", () => {
	test("renders the chat header button as an icon-only menu trigger", () => {
		const html = renderToStaticMarkup(
			<LinkedCodingSessionMenuButtonView
				open={false}
				loading={false}
				sessions={[]}
				onToggle={() => {}}
				onSelect={() => {}}
			/>,
		);

		expect(html).toContain('aria-haspopup="menu"');
		expect(html).toContain('aria-label="Open linked coding sessions"');
		expect(html).not.toContain("border border-dark-700");
	});

	test("renders every provided linked coding session in the menu", () => {
		const html = renderToStaticMarkup(
			<LinkedCodingSessionMenuButtonView
				open
				loading={false}
				sessions={[
					{
						providerId: "codex",
						sdkSessionId: "code-running",
						repositoryId: "repo-1",
						title: "Running task",
						model: "gpt-5.5",
						lastActive: 300,
						cwd: "/workspace/outclaw",
						lifecycleStatus: "open",
						runStatus: "running",
						createdAt: 250,
						source: "code",
						tag: "code",
					},
					{
						providerId: "codex",
						sdkSessionId: "code-idle",
						repositoryId: "repo-1",
						title: "Idle task",
						model: "gpt-5.5",
						lastActive: 100,
						cwd: "/workspace/outclaw",
						lifecycleStatus: "open",
						runStatus: "idle",
						createdAt: 50,
						source: "code",
						tag: "code",
					},
				]}
				onToggle={() => {}}
				onSelect={() => {}}
			/>,
		);

		expect(html).toContain('role="menu"');
		expect(html).toContain("Running task");
		expect(html).toContain("Idle task");
		expect(html).toContain("Running");
		expect(html).toContain("Idle");
	});
});
