import { describe, expect, test } from "bun:test";
import {
	BROWSER_LAYOUT_STORAGE_KEY,
	createLayoutStore,
	MAX_INSPECTOR_WIDTH,
	MAX_RIGHT_PANEL_SPLIT_RATIO,
	MIN_SIDEBAR_WIDTH,
} from "../../../src/frontend/browser/stores/layout.ts";

function createMemoryStorage(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));

	return {
		getItem(name: string) {
			return values.get(name) ?? null;
		},
		removeItem(name: string) {
			values.delete(name);
		},
		setItem(name: string, value: string) {
			values.set(name, value);
		},
	};
}

describe("layout store", () => {
	test("persists column widths and right panel arrangement", () => {
		const storage = createMemoryStorage();
		const store = createLayoutStore(storage);

		store.getState().setLeftCollapsed(true);
		store.getState().setRightCollapsed(true);
		store.getState().setSidebarWidth(312);
		store.getState().setInspectorWidth(418);
		store.getState().setRightPanelSplitRatio(0.63);
		store.getState().setRightPanelLayout({
			upperTabs: ["files", "terminal"],
			lowerTabs: ["git", "cron"],
			activeUpperTab: "terminal",
			activeLowerTab: "git",
		});

		const persisted = storage.getItem(BROWSER_LAYOUT_STORAGE_KEY);
		expect(persisted).not.toBeNull();

		const rehydratedStore = createLayoutStore(storage);
		expect(rehydratedStore.getState().leftCollapsed).toBe(true);
		expect(rehydratedStore.getState().rightCollapsed).toBe(true);
		expect(rehydratedStore.getState().sidebarWidth).toBe(312);
		expect(rehydratedStore.getState().inspectorWidth).toBe(418);
		expect(rehydratedStore.getState().rightPanelSplitRatio).toBe(0.63);
		expect(rehydratedStore.getState().rightPanelLayout).toEqual({
			upperTabs: ["files", "terminal"],
			lowerTabs: ["git", "cron"],
			activeUpperTab: "terminal",
			activeLowerTab: "git",
		});
	});

	test("sanitizes invalid persisted layout state", () => {
		const storage = createMemoryStorage({
			[BROWSER_LAYOUT_STORAGE_KEY]: JSON.stringify({
				state: {
					inspectorWidth: 9999,
					rightPanelLayout: {
						upperTabs: [],
						lowerTabs: ["git", "git", "unknown"],
						activeUpperTab: "missing",
						activeLowerTab: "missing",
					},
					rightPanelSplitRatio: 99,
					sidebarWidth: -10,
				},
				version: 1,
			}),
		});

		const store = createLayoutStore(storage);

		expect(store.getState().leftCollapsed).toBe(false);
		expect(store.getState().rightCollapsed).toBe(false);
		expect(store.getState().sidebarWidth).toBe(MIN_SIDEBAR_WIDTH);
		expect(store.getState().inspectorWidth).toBe(MAX_INSPECTOR_WIDTH);
		expect(store.getState().rightPanelSplitRatio).toBe(
			MAX_RIGHT_PANEL_SPLIT_RATIO,
		);
		expect(store.getState().rightPanelLayout).toEqual({
			upperTabs: ["git", "files", "cron", "terminal"],
			lowerTabs: [],
			activeUpperTab: "git",
			activeLowerTab: "git",
		});
	});
});
