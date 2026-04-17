import { describe, expect, test } from "bun:test";
import {
	coerceUpperRightPanelTab,
	UPPER_RIGHT_PANEL_TABS,
} from "../../../src/frontend/browser/components/right-panel/right-panel-layout.ts";

describe("right panel layout helpers", () => {
	test("exposes the fixed upper-pane tab order", () => {
		expect(UPPER_RIGHT_PANEL_TABS).toEqual(["files", "git", "cron"]);
	});

	test("coerces invalid persisted upper tabs back to files", () => {
		expect(coerceUpperRightPanelTab("files")).toBe("files");
		expect(coerceUpperRightPanelTab("cron")).toBe("cron");
		expect(coerceUpperRightPanelTab("git")).toBe("git");
		expect(coerceUpperRightPanelTab("terminal")).toBe("files");
		expect(coerceUpperRightPanelTab("missing")).toBe("files");
	});
});
