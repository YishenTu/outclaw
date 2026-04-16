export const RIGHT_PANEL_TABS = ["files", "cron", "git", "terminal"] as const;

export type RightPanelTab = (typeof RIGHT_PANEL_TABS)[number];

export interface RightPanelLayoutState {
	upperTabs: RightPanelTab[];
	lowerTabs: RightPanelTab[];
	activeUpperTab: RightPanelTab;
	activeLowerTab: RightPanelTab;
}

function clampInsertIndex(index: number, max: number): number {
	return Math.max(0, Math.min(index, max));
}

function ensureActiveTab(
	tabs: RightPanelTab[],
	activeTab: RightPanelTab,
): RightPanelTab {
	return tabs.includes(activeTab) ? activeTab : (tabs[0] ?? activeTab);
}

function reorderTabs(
	tabs: RightPanelTab[],
	droppedTab: RightPanelTab,
	targetIndex: number,
): RightPanelTab[] {
	const fromIndex = tabs.indexOf(droppedTab);
	if (fromIndex === -1) {
		return tabs;
	}

	const insertIndex = clampInsertIndex(targetIndex, tabs.length);
	const adjustedIndex = fromIndex < insertIndex ? insertIndex - 1 : insertIndex;
	if (adjustedIndex === fromIndex) {
		return tabs;
	}

	const nextTabs = [...tabs];
	nextTabs.splice(fromIndex, 1);
	nextTabs.splice(adjustedIndex, 0, droppedTab);
	return nextTabs;
}

export function moveRightPanelTab(
	state: RightPanelLayoutState,
	droppedTab: RightPanelTab,
	toLower: boolean,
	targetIndex?: number,
): RightPanelLayoutState {
	const fromLower = state.lowerTabs.includes(droppedTab);
	const fromUpper = state.upperTabs.includes(droppedTab);

	if (!fromLower && !fromUpper) {
		return state;
	}

	if (fromLower === toLower) {
		const currentTabs = fromLower ? state.lowerTabs : state.upperTabs;
		const nextTabs = reorderTabs(
			currentTabs,
			droppedTab,
			targetIndex ?? currentTabs.length,
		);
		if (nextTabs === currentTabs) {
			return state;
		}

		return fromLower
			? {
					...state,
					lowerTabs: nextTabs,
					activeLowerTab: ensureActiveTab(nextTabs, state.activeLowerTab),
				}
			: {
					...state,
					upperTabs: nextTabs,
					activeUpperTab: ensureActiveTab(nextTabs, state.activeUpperTab),
				};
	}

	if (toLower) {
		if (state.upperTabs.length <= 1) {
			return state;
		}

		const nextUpperTabs = state.upperTabs.filter((tab) => tab !== droppedTab);
		const insertIndex = clampInsertIndex(
			targetIndex ?? state.lowerTabs.length,
			state.lowerTabs.length,
		);
		const nextLowerTabs = [...state.lowerTabs];
		nextLowerTabs.splice(insertIndex, 0, droppedTab);

		return {
			upperTabs: nextUpperTabs,
			lowerTabs: nextLowerTabs,
			activeUpperTab:
				state.activeUpperTab === droppedTab
					? ensureActiveTab(nextUpperTabs, nextUpperTabs[0] ?? droppedTab)
					: ensureActiveTab(nextUpperTabs, state.activeUpperTab),
			activeLowerTab: droppedTab,
		};
	}

	const nextLowerTabs = state.lowerTabs.filter((tab) => tab !== droppedTab);
	const insertIndex = clampInsertIndex(
		targetIndex ?? state.upperTabs.length,
		state.upperTabs.length,
	);
	const nextUpperTabs = [...state.upperTabs];
	nextUpperTabs.splice(insertIndex, 0, droppedTab);

	return {
		upperTabs: nextUpperTabs,
		lowerTabs: nextLowerTabs,
		activeUpperTab: droppedTab,
		activeLowerTab:
			nextLowerTabs.length === 0
				? state.activeLowerTab
				: state.activeLowerTab === droppedTab
					? ensureActiveTab(nextLowerTabs, nextLowerTabs[0] ?? droppedTab)
					: ensureActiveTab(nextLowerTabs, state.activeLowerTab),
	};
}
