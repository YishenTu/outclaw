import { describe, expect, test } from "bun:test";
import { CenterPanelBreadcrumb } from "../../../src/frontend/browser/components/center/center-panel-breadcrumb.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

describe("CenterPanelBreadcrumb", () => {
	test("keeps the leading/title breadcrumb on one truncating line", () => {
		const longTitle =
			"Investigate the provider neutral runtime orchestration boundary without wrapping the center header";

		const html = renderToStaticMarkup(
			<CenterPanelBreadcrumb leading="railly" title={longTitle} />,
		);

		expect(html).toContain("railly");
		expect(html).toContain(longTitle);
		expect(html).toContain(`title="railly/${longTitle}"`);
		expect(html).toContain("overflow-hidden whitespace-nowrap font-mono-ui");
		expect(html).toContain(`class="max-w-[45%] shrink-0 truncate`);
		expect(html).toContain(`class="min-w-0 flex-1 truncate">${longTitle}`);
	});

	test("keeps title-only headers on the same truncating contract", () => {
		const html = renderToStaticMarkup(
			<CenterPanelBreadcrumb title="New session" />,
		);

		expect(html).toContain(`title="New session"`);
		expect(html).toContain("overflow-hidden whitespace-nowrap font-mono-ui");
		expect(html).toContain(`class="min-w-0 flex-1 truncate">New session`);
		expect(html).not.toContain('text-dark-700">/');
	});
});
