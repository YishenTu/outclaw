import { create } from "zustand";

export type Tab =
	| { type: "chat"; id: "chat" }
	| { type: "file"; id: string; path: string; agentId: string }
	| { type: "git-diff"; id: string; path: string }
	| { type: "git-commit"; id: string; sha: string; title: string };

export interface TabsState {
	tabs: Tab[];
	activeTabId: string;
	scrollPositions: Record<string, number>;

	openTab: (tab: Tab) => void;
	closeTab: (tabId: string) => void;
	setActiveTab: (tabId: string) => void;
	closeAllFileTabs: () => void;
	setScrollPosition: (tabId: string, scrollTop: number) => void;
}

const CHAT_TAB: Tab = { type: "chat", id: "chat" };

export const useTabsStore = create<TabsState>((set) => ({
	tabs: [CHAT_TAB],
	activeTabId: CHAT_TAB.id,
	scrollPositions: {},
	openTab: (tab) =>
		set((state) => {
			if (tab.type === "chat") {
				return { activeTabId: CHAT_TAB.id };
			}
			const exists = state.tabs.some((entry) => entry.id === tab.id);
			return {
				tabs: exists ? state.tabs : [...state.tabs, tab],
				activeTabId: tab.id,
			};
		}),
	closeTab: (tabId) =>
		set((state) => {
			if (tabId === CHAT_TAB.id) {
				return state;
			}
			const nextTabs = state.tabs.filter((tab) => tab.id !== tabId);
			const fallbackTab = nextTabs[nextTabs.length - 1] ?? CHAT_TAB;
			const { [tabId]: _discardedScroll, ...nextScrollPositions } =
				state.scrollPositions;
			return {
				tabs: nextTabs.length > 0 ? nextTabs : [CHAT_TAB],
				activeTabId:
					state.activeTabId === tabId ? fallbackTab.id : state.activeTabId,
				scrollPositions: nextScrollPositions,
			};
		}),
	setActiveTab: (tabId) =>
		set((state) =>
			state.tabs.some((tab) => tab.id === tabId)
				? { activeTabId: tabId }
				: state,
		),
	closeAllFileTabs: () =>
		set({
			tabs: [CHAT_TAB],
			activeTabId: CHAT_TAB.id,
			scrollPositions: {},
		}),
	setScrollPosition: (tabId, scrollTop) =>
		set((state) => ({
			scrollPositions: {
				...state.scrollPositions,
				[tabId]: scrollTop,
			},
		})),
}));
