import { expect, test } from "@playwright/test";

const SIDEBAR_SUMMARY = {
	activeAgentId: "agent-railly",
	agents: [
		{
			agentId: "agent-railly",
			name: "railly",
			activeSession: null,
			sessions: [],
		},
	],
};

test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		window.localStorage.clear();
		class OpenWebSocket extends EventTarget {
			static readonly OPEN = 1;
			readonly readyState = OpenWebSocket.OPEN;
			onopen: ((event: Event) => void) | null = null;
			onclose: ((event: Event) => void) | null = null;
			onerror: ((event: Event) => void) | null = null;
			onmessage: ((event: MessageEvent) => void) | null = null;
			constructor() {
				super();
				queueMicrotask(() => this.onopen?.(new Event("open")));
			}
			close() {
				this.onclose?.(new Event("close"));
			}
			send() {}
		}
		window.WebSocket = OpenWebSocket as unknown as typeof WebSocket;
	});
	await page.route("**/*", async (route) => {
		const path = new URL(route.request().url()).pathname;
		if (!path.startsWith("/api/")) {
			await route.continue();
			return;
		}
		if (path === "/api/agents") {
			await route.fulfill({ json: SIDEBAR_SUMMARY });
			return;
		}
		if (path === "/api/latency") {
			await route.fulfill({ json: { ok: true } });
			return;
		}
		if (path.endsWith("/chat-models")) {
			await route.fulfill({ json: { models: [] } });
			return;
		}
		if (path.endsWith("/graph")) {
			await route.fulfill({ json: { nodes: [], links: [] } });
			return;
		}
		if (path === "/api/config") {
			await route.fulfill({
				json: { path: "config.json", document: {}, schema: { kind: "object" } },
			});
			return;
		}
		if (path === "/api/coding/repositories") {
			await route.fulfill({ json: { repositories: [] } });
			return;
		}
		if (path === "/api/coding/models") {
			await route.fulfill({ json: { models: [] } });
			return;
		}
		await route.fulfill({ json: [] });
	});
});

test("renders the desktop welcome experience", async ({ page }, testInfo) => {
	test.skip(testInfo.project.name !== "desktop");
	await page.goto("/");
	await expect(
		page.getByRole("region", { name: "Welcome page" }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Choose agent" }),
	).toContainText("@railly");
});

test("renders at a mobile viewport without horizontal overflow", async ({
	page,
}, testInfo) => {
	test.skip(testInfo.project.name !== "mobile");
	await page.goto("/");
	await expect(page.locator("#root")).not.toBeEmpty();
	const overflow = await page.evaluate(
		() =>
			document.documentElement.scrollWidth >
			document.documentElement.clientWidth,
	);
	expect(overflow).toBe(false);
});

test("loads code mode on demand", async ({ page }, testInfo) => {
	test.skip(testInfo.project.name !== "desktop");
	await page.goto("/");
	await page.getByRole("tab", { name: "Code" }).click();
	await expect(page.getByRole("tab", { name: "Code" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(
		page.getByText("No active repositories.", { exact: false }),
	).toBeVisible();
});

test("config dialog closes with Escape and restores focus", async ({
	page,
}, testInfo) => {
	test.skip(testInfo.project.name !== "desktop");
	await page.goto("/");
	const trigger = page.getByRole("button", { name: "Open config panel" });
	await trigger.click();
	await expect(
		page.getByRole("dialog", { name: "Config modal" }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog", { name: "Config modal" })).toBeHidden();
	await expect(trigger).toBeFocused();
});
