import { describe, expect, test } from "bun:test";
import {
	DEFAULT_DESKTOP_LAYOUT_WIDTH,
	DEFAULT_SIDEBAR_WIDTH,
	MAX_INSPECTOR_WIDTH,
	MAX_SIDEBAR_WIDTH,
	MIN_INSPECTOR_WIDTH,
	MIN_SIDEBAR_WIDTH,
} from "../../../src/frontend/browser/layout-dimensions.ts";
import {
	applyAppLayoutResizeBodyStyles,
	calculateLayoutResizeWidth,
	calculateMaxInspectorWidth,
	resolveInspectorFit,
} from "../../../src/frontend/browser/layouts/app-layout-policy.ts";

describe("browser app layout policy", () => {
	test("clamps left and right resize widths", () => {
		expect(
			calculateLayoutResizeWidth({
				clientX: -100,
				containerLeft: 0,
				containerRight: 1200,
				containerWidth: 1200,
				leftCollapsed: false,
				showWelcomePage: false,
				side: "left",
				sidebarWidth: 260,
			}),
		).toBe(MIN_SIDEBAR_WIDTH);
		expect(
			calculateLayoutResizeWidth({
				clientX: 9999,
				containerLeft: 0,
				containerRight: 1200,
				containerWidth: 1200,
				leftCollapsed: false,
				showWelcomePage: false,
				side: "left",
				sidebarWidth: 260,
			}),
		).toBe(MAX_SIDEBAR_WIDTH);
		expect(
			calculateLayoutResizeWidth({
				clientX: 200,
				containerLeft: 0,
				containerRight: 1200,
				containerWidth: 1600,
				leftCollapsed: true,
				showWelcomePage: false,
				side: "right",
				sidebarWidth: 260,
			}),
		).toBe(MAX_INSPECTOR_WIDTH);
		expect(
			calculateLayoutResizeWidth({
				clientX: 0,
				containerLeft: 0,
				containerRight: 1280,
				containerWidth: 1280,
				leftCollapsed: false,
				showWelcomePage: false,
				side: "right",
				sidebarWidth: 260,
			}),
		).toBe(MAX_INSPECTOR_WIDTH);
	});

	test("calculates max inspector width from visible left-side policy", () => {
		expect(
			calculateMaxInspectorWidth({
				containerWidth: DEFAULT_DESKTOP_LAYOUT_WIDTH,
				leftCollapsed: false,
				showWelcomePage: false,
				sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
			}),
		).toBe(MAX_INSPECTOR_WIDTH);
		expect(
			calculateMaxInspectorWidth({
				containerWidth: 1200,
				leftCollapsed: false,
				showWelcomePage: false,
				sidebarWidth: 300,
			}),
		).toBe(386);
		expect(
			calculateMaxInspectorWidth({
				containerWidth: 1200,
				leftCollapsed: true,
				showWelcomePage: false,
				sidebarWidth: 300,
			}),
		).toBe(686);
		expect(
			calculateMaxInspectorWidth({
				containerWidth: 700,
				leftCollapsed: false,
				showWelcomePage: false,
				sidebarWidth: 300,
			}),
		).toBe(MIN_INSPECTOR_WIDTH);
	});

	test("resizes, collapses, or keeps the inspector when the viewport changes", () => {
		expect(
			resolveInspectorFit({
				inspectorWidth: 420,
				maxInspectorWidth: 500,
				rightCollapsed: false,
			}),
		).toEqual({ type: "keep" });
		expect(
			resolveInspectorFit({
				inspectorWidth: 600,
				maxInspectorWidth: 420,
				rightCollapsed: false,
			}),
		).toEqual({ type: "resize", inspectorWidth: 420 });
		expect(
			resolveInspectorFit({
				inspectorWidth: 600,
				maxInspectorWidth: 300,
				rightCollapsed: false,
			}),
		).toEqual({ type: "collapse" });
	});

	test("applies and cleans up body styles during resize", () => {
		const body = { cursor: "", userSelect: "" };
		const cleanup = applyAppLayoutResizeBodyStyles(body);

		expect(body).toEqual({ cursor: "col-resize", userSelect: "none" });
		cleanup();
		expect(body).toEqual({ cursor: "", userSelect: "" });
	});
});
