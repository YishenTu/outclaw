import { create } from "zustand";
import {
	createJSONStorage,
	persist,
	type StateStorage,
} from "zustand/middleware";
import {
	DEFAULT_INSPECTOR_WIDTH,
	DEFAULT_RIGHT_PANEL_SPLIT_RATIO,
	DEFAULT_SIDEBAR_WIDTH,
	MAX_INSPECTOR_WIDTH,
	MAX_RIGHT_PANEL_SPLIT_RATIO,
	MAX_SIDEBAR_WIDTH,
	MIN_INSPECTOR_WIDTH,
	MIN_RIGHT_PANEL_SPLIT_RATIO,
	MIN_SIDEBAR_WIDTH,
} from "../layouts/layout-dimensions.ts";
import {
	coerceUpperRightPanelTab,
	type UpperRightPanelTab,
} from "../layouts/right-panel-layout.ts";

export const BROWSER_LAYOUT_STORAGE_KEY = "outclaw.browser.layout";

export interface LayoutState {
	inspectorWidth: number;
	leftCollapsed: boolean;
	rightGitHistoryCollapsed: boolean;
	rightPanelUpperTab: UpperRightPanelTab;
	rightPanelSplitRatio: number;
	rightCollapsed: boolean;
	rightTerminalCollapsed: boolean;
	sidebarWidth: number;

	resetLayout: () => void;
	setInspectorWidth: (width: number) => void;
	setLeftCollapsed: (collapsed: boolean) => void;
	setRightGitHistoryCollapsed: (collapsed: boolean) => void;
	setRightPanelUpperTab: (tab: UpperRightPanelTab) => void;
	setRightPanelSplitRatio: (ratio: number) => void;
	setRightCollapsed: (collapsed: boolean) => void;
	setRightTerminalCollapsed: (collapsed: boolean) => void;
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

function sanitizeState(state: {
	inspectorWidth: number;
	leftCollapsed: boolean;
	rightGitHistoryCollapsed: boolean;
	rightCollapsed: boolean;
	rightPanelSplitRatio: number;
	rightPanelUpperTab: string;
	rightTerminalCollapsed: boolean;
	sidebarWidth: number;
}) {
	return {
		inspectorWidth: clampWidth(
			state.inspectorWidth,
			MIN_INSPECTOR_WIDTH,
			MAX_INSPECTOR_WIDTH,
			DEFAULT_INSPECTOR_WIDTH,
		),
		leftCollapsed: state.leftCollapsed === true,
		rightGitHistoryCollapsed: state.rightGitHistoryCollapsed === true,
		rightPanelUpperTab: coerceUpperRightPanelTab(state.rightPanelUpperTab),
		rightPanelSplitRatio: clampSplitRatio(state.rightPanelSplitRatio),
		rightCollapsed: state.rightCollapsed === true,
		rightTerminalCollapsed: state.rightTerminalCollapsed === true,
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
		rightGitHistoryCollapsed: false,
		rightPanelUpperTab: "files" as UpperRightPanelTab,
		rightPanelSplitRatio: DEFAULT_RIGHT_PANEL_SPLIT_RATIO,
		rightCollapsed: false,
		rightTerminalCollapsed: false,
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
				setRightGitHistoryCollapsed: (rightGitHistoryCollapsed) =>
					set({ rightGitHistoryCollapsed }),
				setRightPanelUpperTab: (rightPanelUpperTab) =>
					set({
						rightPanelUpperTab: coerceUpperRightPanelTab(rightPanelUpperTab),
					}),
				setRightPanelSplitRatio: (ratio) =>
					set({
						rightPanelSplitRatio: clampSplitRatio(ratio),
					}),
				setRightCollapsed: (rightCollapsed) => set({ rightCollapsed }),
				setRightTerminalCollapsed: (rightTerminalCollapsed) =>
					set({ rightTerminalCollapsed }),
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
						rightGitHistoryCollapsed:
							(
								persistedState as Partial<
									ReturnType<typeof getDefaultState>
								> & {
									rightGitGraphCollapsed?: boolean;
								}
							).rightGitHistoryCollapsed ??
							(
								persistedState as Partial<{
									rightGitGraphCollapsed?: boolean;
								}>
							).rightGitGraphCollapsed ??
							currentState.rightGitHistoryCollapsed,
						rightPanelUpperTab:
							(
								persistedState as Partial<
									ReturnType<typeof getDefaultState>
								> & {
									rightPanelLayout?: {
										activeUpperTab?: string;
									};
								}
							).rightPanelUpperTab ??
							(
								persistedState as Partial<{
									rightPanelLayout?: {
										activeUpperTab?: string;
									};
								}>
							).rightPanelLayout?.activeUpperTab ??
							currentState.rightPanelUpperTab,
						rightPanelSplitRatio:
							(persistedState as Partial<ReturnType<typeof getDefaultState>>)
								.rightPanelSplitRatio ?? currentState.rightPanelSplitRatio,
						rightCollapsed:
							(persistedState as Partial<ReturnType<typeof getDefaultState>>)
								.rightCollapsed ?? currentState.rightCollapsed,
						rightTerminalCollapsed:
							(persistedState as Partial<ReturnType<typeof getDefaultState>>)
								.rightTerminalCollapsed ?? currentState.rightTerminalCollapsed,
						sidebarWidth:
							(persistedState as Partial<ReturnType<typeof getDefaultState>>)
								.sidebarWidth ?? currentState.sidebarWidth,
					}),
				}),
				name: BROWSER_LAYOUT_STORAGE_KEY,
				partialize: (state) => ({
					inspectorWidth: state.inspectorWidth,
					leftCollapsed: state.leftCollapsed,
					rightGitHistoryCollapsed: state.rightGitHistoryCollapsed,
					rightPanelUpperTab: state.rightPanelUpperTab,
					rightPanelSplitRatio: state.rightPanelSplitRatio,
					rightCollapsed: state.rightCollapsed,
					rightTerminalCollapsed: state.rightTerminalCollapsed,
					sidebarWidth: state.sidebarWidth,
				}),
				storage: resolvePersistStorage(storage),
				version: 1,
			},
		),
	);
}

export const useLayoutStore = createLayoutStore();
