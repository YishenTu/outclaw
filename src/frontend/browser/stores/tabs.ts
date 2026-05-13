import { create } from "zustand";
import {
	activateBrowserTabState,
	CHAT_TAB,
	closeAllBrowserFileTabsState,
	closeBrowserTabState,
	openBrowserTabState,
	setBrowserTabScrollPositionState,
} from "./tab-policy.ts";

export type Tab =
	| { type: "chat"; id: "chat" }
	| { type: "file"; id: string; path: string; agentId: string }
	| { type: "git-diff"; id: string; path: string }
	| { type: "git-commit"; id: string; sha: string; title: string }
	| {
			type: "coding-session";
			id: string;
			providerId: string;
			sdkSessionId: string;
			repositoryId: string;
			title: string;
	  };

export interface TabsState {
	tabs: Tab[];
	activeTabId: string;
	scrollPositions: Record<string, number>;

	openTab: (tab: Tab, options?: { activate?: boolean }) => void;
	closeTab: (tabId: string) => void;
	setActiveTab: (tabId: string) => void;
	closeAllFileTabs: () => void;
	setScrollPosition: (tabId: string, scrollTop: number) => void;
}

export const useTabsStore = create<TabsState>((set) => ({
	tabs: [CHAT_TAB],
	activeTabId: CHAT_TAB.id,
	scrollPositions: {},
	openTab: (tab, options) =>
		set((state) => openBrowserTabState(state, tab, options)),
	closeTab: (tabId) => set((state) => closeBrowserTabState(state, tabId)),
	setActiveTab: (tabId) =>
		set((state) => activateBrowserTabState(state, tabId)),
	closeAllFileTabs: () => set(closeAllBrowserFileTabsState()),
	setScrollPosition: (tabId, scrollTop) =>
		set((state) => setBrowserTabScrollPositionState(state, tabId, scrollTop)),
}));
