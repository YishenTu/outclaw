export const DEFAULT_DESKTOP_LAYOUT_WIDTH = 1280;

export const MIN_SIDEBAR_WIDTH = 220;
export const MAX_SIDEBAR_WIDTH = 360;
export const DEFAULT_SIDEBAR_WIDTH = 260;

export const MIN_INSPECTOR_WIDTH = 300;
export const MAX_INSPECTOR_WIDTH = 506;
export const DEFAULT_INSPECTOR_WIDTH = 360;

export const MIN_RIGHT_PANEL_SPLIT_RATIO = 0.2;
export const MAX_RIGHT_PANEL_SPLIT_RATIO = 0.8;
export const DEFAULT_RIGHT_PANEL_SPLIT_RATIO = 0.56;

// Keep the right panel's configured maximum reachable at the default desktop width.
export const MIN_CENTER_WIDTH =
	DEFAULT_DESKTOP_LAYOUT_WIDTH - DEFAULT_SIDEBAR_WIDTH - MAX_INSPECTOR_WIDTH;
