import { describe, expect, test } from "bun:test";
import { BrowserRestartNoticeContent } from "../../../src/frontend/browser/components/browser-restart-notice.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

describe("BrowserRestartNotice", () => {
	test("does not render without a restart notice", () => {
		const html = renderToStaticMarkup(
			<BrowserRestartNoticeContent notice={null} />,
		);

		expect(html).toBe("");
	});

	test("renders the restart-required browser banner copy", () => {
		const html = renderToStaticMarkup(
			<BrowserRestartNoticeContent notice={{ kind: "restart_required" }} />,
		);

		expect(html).toContain("Restart required");
		expect(html).toContain(
			"Agent changes won&#x27;t update until the runtime restarts.",
		);
	});
});
