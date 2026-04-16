import { create } from "zustand";
import {
	createJSONStorage,
	persist,
	type StateStorage,
} from "zustand/middleware";
import {
	RIGHT_PANEL_TABS,
	type RightPanelLayoutState,
	type RightPanelTab,
} from "../components/right-panel/right-panel-layout.ts";

export const BROWSER_LAYOUT_STORAGE_KEY = "outclaw.browser.layout";

export const MIN_SIDEBAR_WIDTH = 220;
export const MAX_SIDEBAR_WIDTH = 360;
export const DEFAULT_SIDEBAR_WIDTH = 260;

export const MIN_INSPECTOR_WIDTH = 300;
export const MAX_INSPECTOR_WIDTH = 460;
export const DEFAULT_INSPECTOR_WIDTH = 360;

export const MIN_RIGHT_PANEL_SPLIT_RATIO = 0.2;
export const MAX_RIGHT_PANEL_SPLIT_RATIO = 0.8;
export const DEFAULT_RIGHT_PANEL_SPLIT_RATIO = 0.56;

export const DEFAULT_RIGHT_PANEL_LAYOUT: RightPanelLayoutState = {
	upperTabs: [...RIGHT_PANEL_TABS],
	lowerTabs: [],
	activeUpperTab: "files",
	activeLowerTab: "git",
};

type LayoutUpdater<T> = T | ((current: T) => T);

export interface LayoutState {
	inspectorWidth: number;
	leftCollapsed: boolean;
	rightPanelLayout: RightPanelLayoutState;
	rightPanelSplitRatio: number;
	rightCollapsed: boolean;
	sidebarWidth: number;

	resetLayout: () => void;
	setInspectorWidth: (width: number) => void;
	setLeftCollapsed: (collapsed: boolean) => void;
	setRightPanelLayout: (layout: LayoutUpdater<RightPanelLayoutState>) => void;
	setRightPanelSplitRatio: (ratio: number) => void;
	setRightCollapsed: (collapsed: boolean) => void;
	setSidebarWidth: (width: number) => void;
}

function clampWidth(
	width: number,
	min: number,
	max: number,
	fallback: number,
): number {
	if (!Number.isFinite(width)) {
		return fallback;
	}

	return Math.max(min, Math.min(max, width));
}

function clampSplitRatio(ratio: number): number {
	if (!Number.isFinite(ratio)) {
		return DEFAULT_RIGHT_PANEL_SPLIT_RATIO;
	}

	return Math.max(
		MIN_RIGHT_PANEL_SPLIT_RATIO,
		Math.min(MAX_RIGHT_PANEL_SPLIT_RATIO, ratio),
	);
}

function collectUniqueTabs(
	tabs: RightPanelTab[],
	seen: Set<RightPanelTab>,
): RightPanelTab[] {
	return tabs.filter((tab) => {
		if (!RIGHT_PANEL_TABS.includes(tab) || seen.has(tab)) {
			return false;
		}

		seen.add(tab);
		return true;
	});
}

export function sanitizeRightPanelLayout(
	layout: RightPanelLayoutState,
): RightPanelLayoutState {
	const seen = new Set<RightPanelTab>();
	let upperTabs = collectUniqueTabs(layout.upperTabs, seen);
	let lowerTabs = collectUniqueTabs(layout.lowerTabs, seen);
	const remainingTabs = RIGHT_PANEL_TABS.filter((tab) => !seen.has(tab));

	if (upperTabs.length === 0) {
		const promotedTab = lowerTabs[0] ?? remainingTabs[0] ?? "files";
		upperTabs = [promotedTab];
		lowerTabs = lowerTabs.filter((tab) => tab !== promotedTab);
	}

	upperTabs = [
		...upperTabs,
		...remainingTabs.filter((tab) => tab !== upperTabs[0]),
	];

	const activeUpperTab = upperTabs.includes(layout.activeUpperTab)
		? layout.activeUpperTab
		: (upperTabs[0] ?? DEFAULT_RIGHT_PANEL_LAYOUT.activeUpperTab);
	const activeLowerTab =
		lowerTabs.length === 0
			? DEFAULT_RIGHT_PANEL_LAYOUT.activeLowerTab
			: lowerTabs.includes(layout.activeLowerTab)
				? layout.activeLowerTab
				: (lowerTabs[0] ?? DEFAULT_RIGHT_PANEL_LAYOUT.activeLowerTab);

	return {
		upperTabs,
		lowerTabs,
		activeUpperTab,
		activeLowerTab,
	};
}

function sanitizeState(
	state: Pick<
		LayoutState,
		| "inspectorWidth"
		| "leftCollapsed"
		| "rightPanelLayout"
		| "rightPanelSplitRatio"
		| "rightCollapsed"
		| "sidebarWidth"
	>,
) {
	return {
		inspectorWidth: clampWidth(
			state.inspectorWidth,
			MIN_INSPECTOR_WIDTH,
			MAX_INSPECTOR_WIDTH,
			DEFAULT_INSPECTOR_WIDTH,
		),
		leftCollapsed: state.leftCollapsed === true,
		rightPanelLayout: sanitizeRightPanelLayout(state.rightPanelLayout),
		rightPanelSplitRatio: clampSplitRatio(state.rightPanelSplitRatio),
		rightCollapsed: state.rightCollapsed === true,
		sidebarWidth: clampWidth(
			state.sidebarWidth,
			MIN_SIDEBAR_WIDTH,
			MAX_SIDEBAR_WIDTH,
			DEFAULT_SIDEBAR_WIDTH,
		),
	};
}

function resolvePersistStorage(storage?: StateStorage) {
	if (storage) {
		return createJSONStorage(() => storage);
	}

	if (typeof localStorage === "undefined") {
		return undefined;
	}

	return createJSONStorage(() => localStorage);
}

function getDefaultState() {
	return {
		inspectorWidth: DEFAULT_INSPECTOR_WIDTH,
		leftCollapsed: false,
		rightPanelLayout: DEFAULT_RIGHT_PANEL_LAYOUT,
		rightPanelSplitRatio: DEFAULT_RIGHT_PANEL_SPLIT_RATIO,
		rightCollapsed: false,
		sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
	};
}

export function createLayoutStore(storage?: StateStorage) {
	return create<LayoutState>()(
		persist(
			(set) => ({
				...getDefaultState(),
				resetLayout: () => set(getDefaultState()),
				setInspectorWidth: (width) =>
					set({
						inspectorWidth: clampWidth(
							width,
							MIN_INSPECTOR_WIDTH,
							MAX_INSPECTOR_WIDTH,
							DEFAULT_INSPECTOR_WIDTH,
						),
					}),
				setLeftCollapsed: (leftCollapsed) => set({ leftCollapsed }),
				setRightPanelLayout: (layout) =>
					set((state) => ({
						rightPanelLayout: sanitizeRightPanelLayout(
							typeof layout === "function"
								? layout(state.rightPanelLayout)
								: layout,
						),
					})),
				setRightPanelSplitRatio: (ratio) =>
					set({
						rightPanelSplitRatio: clampSplitRatio(ratio),
					}),
				setRightCollapsed: (rightCollapsed) => set({ rightCollapsed }),
				setSidebarWidth: (width) =>
					set({
						sidebarWidth: clampWidth(
							width,
							MIN_SIDEBAR_WIDTH,
							MAX_SIDEBAR_WIDTH,
							DEFAULT_SIDEBAR_WIDTH,
						),
					}),
			}),
			{
				merge: (persistedState, currentState) => ({
					...currentState,
					...sanitizeState({
						inspectorWidth:
							(persistedState as Partial<ReturnType<typeof getDefaultState>>)
								.inspectorWidth ?? currentState.inspectorWidth,
						leftCollapsed:
							(persistedState as Partial<ReturnType<typeof getDefaultState>>)
								.leftCollapsed ?? currentState.leftCollapsed,
						rightPanelLayout:
							(persistedState as Partial<ReturnType<typeof getDefaultState>>)
								.rightPanelLayout ?? currentState.rightPanelLayout,
						rightPanelSplitRatio:
							(persistedState as Partial<ReturnType<typeof getDefaultState>>)
								.rightPanelSplitRatio ?? currentState.rightPanelSplitRatio,
						rightCollapsed:
							(persistedState as Partial<ReturnType<typeof getDefaultState>>)
								.rightCollapsed ?? currentState.rightCollapsed,
						sidebarWidth:
							(persistedState as Partial<ReturnType<typeof getDefaultState>>)
								.sidebarWidth ?? currentState.sidebarWidth,
					}),
				}),
				name: BROWSER_LAYOUT_STORAGE_KEY,
				partialize: (state) => ({
					inspectorWidth: state.inspectorWidth,
					leftCollapsed: state.leftCollapsed,
					rightPanelLayout: state.rightPanelLayout,
					rightPanelSplitRatio: state.rightPanelSplitRatio,
					rightCollapsed: state.rightCollapsed,
					sidebarWidth: state.sidebarWidth,
				}),
				storage: resolvePersistStorage(storage),
				version: 1,
			},
		),
	);
}

export const useLayoutStore = createLayoutStore();
