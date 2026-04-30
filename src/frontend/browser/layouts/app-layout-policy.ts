import {
	MAX_INSPECTOR_WIDTH,
	MAX_SIDEBAR_WIDTH,
	MIN_INSPECTOR_WIDTH,
	MIN_SIDEBAR_WIDTH,
} from "../stores/layout.ts";

export const MIN_CENTER_WIDTH = 560;
export const MIN_VISIBLE_INSPECTOR_WIDTH = 400;

export function calculateMaxInspectorWidth(params: {
	containerWidth: number;
	leftCollapsed: boolean;
	showWelcomePage: boolean;
	sidebarWidth: number;
}): number {
	return Math.max(
		MIN_INSPECTOR_WIDTH,
		params.containerWidth -
			(params.showWelcomePage || !params.leftCollapsed
				? params.sidebarWidth
				: 0) -
			MIN_CENTER_WIDTH,
	);
}

export function calculateLayoutResizeWidth(params: {
	clientX: number;
	containerLeft: number;
	containerRight: number;
	containerWidth: number;
	leftCollapsed: boolean;
	showWelcomePage: boolean;
	side: "left" | "right";
	sidebarWidth: number;
}): number {
	if (params.side === "left") {
		const nextWidth = params.clientX - params.containerLeft;
		return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, nextWidth));
	}

	const nextWidth = params.containerRight - params.clientX;
	const boundedWidth = Math.min(
		MAX_INSPECTOR_WIDTH,
		Math.max(MIN_INSPECTOR_WIDTH, nextWidth),
	);
	return Math.min(
		calculateMaxInspectorWidth({
			containerWidth: params.containerWidth,
			leftCollapsed: params.leftCollapsed,
			showWelcomePage: params.showWelcomePage,
			sidebarWidth: params.sidebarWidth,
		}),
		boundedWidth,
	);
}

export function resolveInspectorFit(params: {
	inspectorWidth: number;
	maxInspectorWidth: number;
	rightCollapsed: boolean;
}):
	| { type: "keep" }
	| { type: "resize"; inspectorWidth: number }
	| { type: "collapse" } {
	if (
		params.rightCollapsed ||
		params.inspectorWidth <= params.maxInspectorWidth
	) {
		return { type: "keep" };
	}
	if (params.maxInspectorWidth >= MIN_VISIBLE_INSPECTOR_WIDTH) {
		return {
			type: "resize",
			inspectorWidth: params.maxInspectorWidth,
		};
	}
	return { type: "collapse" };
}

export function applyAppLayoutResizeBodyStyles(
	body: Pick<CSSStyleDeclaration, "cursor" | "userSelect">,
) {
	body.cursor = "col-resize";
	body.userSelect = "none";

	return () => {
		body.cursor = "";
		body.userSelect = "";
	};
}
