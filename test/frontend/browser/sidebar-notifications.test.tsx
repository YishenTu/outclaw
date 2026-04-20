import { describe, expect, test } from "bun:test";
import {
	createSidebarNotificationItems,
	SidebarNotificationsContent,
} from "../../../src/frontend/browser/components/agent-sidebar/sidebar-notifications.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

describe("sidebar notifications", () => {
	test("renders a dismiss button for the rollover notice card", () => {
		const items = createSidebarNotificationItems({
			connectionStatus: "connected",
			hasConnectedOnce: true,
			notice: {
				kind: "rollover",
				message: "Session rolled over after idle timeout.",
			},
			onDismissNotice: () => {},
			popup: null,
			runtimeError: null,
		});

		const html = renderToStaticMarkup(
			<SidebarNotificationsContent items={items} />,
		);

		expect(items).toHaveLength(1);
		expect(typeof items[0]?.onDismiss).toBe("function");
		expect(html).toContain("Session rollover");
		expect(html).toContain('aria-label="Dismiss notification"');
	});

	test("does not make the restart-required card dismissible", () => {
		const items = createSidebarNotificationItems({
			connectionStatus: "connected",
			hasConnectedOnce: true,
			notice: {
				kind: "restart_required",
			},
			onDismissNotice: () => {},
			popup: null,
			runtimeError: null,
		});

		const html = renderToStaticMarkup(
			<SidebarNotificationsContent items={items} />,
		);

		expect(items).toHaveLength(1);
		expect(items[0]?.onDismiss).toBeUndefined();
		expect(html).not.toContain('aria-label="Dismiss notification"');
	});
});
