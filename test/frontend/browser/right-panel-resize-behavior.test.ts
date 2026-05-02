import { describe, expect, test } from "bun:test";
import {
	applyRightPanelResizeBodyStyles,
	calculateRightPanelSplitRatio,
	clampRightPanelSplitRatio,
} from "../../../src/frontend/browser/components/right-panel/right-panel-resize-behavior.ts";
import {
	MAX_RIGHT_PANEL_SPLIT_RATIO,
	MIN_RIGHT_PANEL_SPLIT_RATIO,
} from "../../../src/frontend/browser/layouts/layout-dimensions.ts";

describe("right panel resize behavior", () => {
	test("clamps split ratios to the supported range", () => {
		expect(clampRightPanelSplitRatio(0)).toBe(MIN_RIGHT_PANEL_SPLIT_RATIO);
		expect(clampRightPanelSplitRatio(0.5)).toBe(0.5);
		expect(clampRightPanelSplitRatio(1)).toBe(MAX_RIGHT_PANEL_SPLIT_RATIO);
	});

	test("calculates split ratio from pointer position", () => {
		expect(
			calculateRightPanelSplitRatio({
				clientY: 250,
				containerHeight: 400,
				containerTop: 50,
			}),
		).toBe(0.5);
	});

	test("applies and cleans up resize body styles", () => {
		const body = {
			cursor: "",
			userSelect: "",
		};

		const cleanup = applyRightPanelResizeBodyStyles(body);
		expect(body).toEqual({
			cursor: "row-resize",
			userSelect: "none",
		});

		cleanup();
		expect(body).toEqual({
			cursor: "",
			userSelect: "",
		});
	});
});
