import {
	MAX_RIGHT_PANEL_SPLIT_RATIO,
	MIN_RIGHT_PANEL_SPLIT_RATIO,
} from "../../stores/layout.ts";

export function clampRightPanelSplitRatio(ratio: number): number {
	return Math.max(
		MIN_RIGHT_PANEL_SPLIT_RATIO,
		Math.min(MAX_RIGHT_PANEL_SPLIT_RATIO, ratio),
	);
}

export function calculateRightPanelSplitRatio(params: {
	clientY: number;
	containerHeight: number;
	containerTop: number;
}): number {
	return clampRightPanelSplitRatio(
		(params.clientY - params.containerTop) / params.containerHeight,
	);
}

export function applyRightPanelResizeBodyStyles(
	body: Pick<CSSStyleDeclaration, "cursor" | "userSelect">,
) {
	body.userSelect = "none";
	body.cursor = "row-resize";

	return () => {
		body.userSelect = "";
		body.cursor = "";
	};
}
