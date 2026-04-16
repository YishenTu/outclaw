import { describe, expect, test } from "bun:test";
import {
	moveRightPanelTab,
	type RightPanelLayoutState,
} from "../../../src/frontend/browser/components/right-panel/right-panel-layout.ts";

const initialLayout: RightPanelLayoutState = {
	upperTabs: ["files", "cron", "git", "terminal"],
	lowerTabs: [],
	activeUpperTab: "files",
	activeLowerTab: "git",
};

describe("moveRightPanelTab", () => {
	test("moves a tab from upper to lower and activates it there", () => {
		expect(moveRightPanelTab(initialLayout, "git", true)).toEqual({
			upperTabs: ["files", "cron", "terminal"],
			lowerTabs: ["git"],
			activeUpperTab: "files",
			activeLowerTab: "git",
		});
	});

	test("reorders tabs inside the same pane", () => {
		expect(moveRightPanelTab(initialLayout, "terminal", false, 1)).toEqual({
			upperTabs: ["files", "terminal", "cron", "git"],
			lowerTabs: [],
			activeUpperTab: "files",
			activeLowerTab: "git",
		});
	});

	test("moves a lower tab back to upper and activates it there", () => {
		const splitLayout: RightPanelLayoutState = {
			upperTabs: ["files", "cron"],
			lowerTabs: ["git", "terminal"],
			activeUpperTab: "files",
			activeLowerTab: "terminal",
		};

		expect(moveRightPanelTab(splitLayout, "terminal", false, 1)).toEqual({
			upperTabs: ["files", "terminal", "cron"],
			lowerTabs: ["git"],
			activeUpperTab: "terminal",
			activeLowerTab: "git",
		});
	});

	test("refuses to move the last upper tab into lower", () => {
		const nearlyEmptyUpper: RightPanelLayoutState = {
			upperTabs: ["files"],
			lowerTabs: ["cron", "git", "terminal"],
			activeUpperTab: "files",
			activeLowerTab: "cron",
		};

		expect(moveRightPanelTab(nearlyEmptyUpper, "files", true)).toEqual(
			nearlyEmptyUpper,
		);
	});
});
