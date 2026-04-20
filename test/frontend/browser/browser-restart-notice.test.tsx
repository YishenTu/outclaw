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

		expect(html).toContain("max-w-4xl");
		expect(html).toContain("Restart required");
		expect(html).toContain(
			"Changes won&#x27;t update until the runtime restarts.",
		);
	});

	test("renders a dismiss button for rollover notices", () => {
		const html = renderToStaticMarkup(
			<BrowserRestartNoticeContent
				notice={{
					kind: "rollover",
					message: "Session rolled over after idle timeout.",
				}}
				onDismiss={() => {}}
			/>,
		);

		expect(html).toContain("Session rollover");
		expect(html).toContain("Session rolled over after idle timeout.");
		expect(html).toContain('aria-label="Dismiss notification"');
	});
});
