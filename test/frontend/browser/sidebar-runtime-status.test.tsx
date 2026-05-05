import { describe, expect, test } from "bun:test";
import { SidebarRuntimeStatusView } from "../../../src/frontend/browser/components/agent-sidebar/sidebar-runtime-status.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

describe("SidebarRuntimeStatusView", () => {
	test("renders connected runtime status with RTT latency", () => {
		const html = renderToStaticMarkup(
			<SidebarRuntimeStatusView
				configOpen={false}
				connectionStatus="connected"
				error={null}
				latency={{ rttMs: 4, status: "ready" }}
				onRestart={() => {}}
				onToggleConfig={() => {}}
			/>,
		);

		expect(html).toContain("Connected · RTT 4ms");
	});
});
