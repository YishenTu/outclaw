import type { Tab, TabsState } from "./tabs.ts";

export const CHAT_TAB: Tab = { type: "chat", id: "chat" };

type TabStateSnapshot = Pick<
	TabsState,
	"activeTabId" | "scrollPositions" | "tabs"
>;

export function openBrowserTabState(
	state: TabStateSnapshot,
	tab: Tab,
): Partial<TabStateSnapshot> {
	if (tab.type === "chat") {
		return { activeTabId: CHAT_TAB.id };
	}
	const exists = state.tabs.some((entry) => entry.id === tab.id);
	return {
		tabs: exists ? state.tabs : [...state.tabs, tab],
		activeTabId: tab.id,
	};
}

export function closeBrowserTabState(
	state: TabStateSnapshot,
	tabId: string,
): Partial<TabStateSnapshot> {
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
}

export function activateBrowserTabState(
	state: TabStateSnapshot,
	tabId: string,
): Partial<TabStateSnapshot> {
	return state.tabs.some((tab) => tab.id === tabId)
		? { activeTabId: tabId }
		: state;
}

export function closeAllBrowserFileTabsState(): TabStateSnapshot {
	return {
		tabs: [CHAT_TAB],
		activeTabId: CHAT_TAB.id,
		scrollPositions: {},
	};
}

export function setBrowserTabScrollPositionState(
	state: TabStateSnapshot,
	tabId: string,
	scrollTop: number,
): Partial<TabStateSnapshot> {
	return {
		scrollPositions: {
			...state.scrollPositions,
			[tabId]: scrollTop,
		},
	};
}
