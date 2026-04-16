export const UPPER_RIGHT_PANEL_TABS = ["files", "cron", "git"] as const;

export type UpperRightPanelTab = (typeof UPPER_RIGHT_PANEL_TABS)[number];

export function isUpperRightPanelTab(
	value: string,
): value is UpperRightPanelTab {
	return UPPER_RIGHT_PANEL_TABS.includes(value as UpperRightPanelTab);
}

export function coerceUpperRightPanelTab(value: string): UpperRightPanelTab {
	return isUpperRightPanelTab(value) ? value : "files";
}
