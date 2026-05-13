import type { BrowserCodingSessionSummary } from "../../../common/protocol.ts";
import type { Tab, TabsState } from "./tabs.ts";

export const CHAT_TAB: Tab = { type: "chat", id: "chat" };

type TabStateSnapshot = Pick<
	TabsState,
	"activeTabId" | "scrollPositions" | "tabs"
>;

interface OpenBrowserTabOptions {
	activate?: boolean;
}

export function codingSessionTabId(session: {
	providerId: string;
	repositoryId: string;
	sdkSessionId: string;
}): string {
	return `coding:${session.repositoryId}:${session.providerId}:${session.sdkSessionId}`;
}

export function makeCodingSessionCenterTab(
	session: BrowserCodingSessionSummary,
): Extract<Tab, { type: "coding-session" }> | undefined {
	if (!session.repositoryId) {
		return undefined;
	}
	return {
		type: "coding-session",
		id: codingSessionTabId({
			providerId: session.providerId,
			repositoryId: session.repositoryId,
			sdkSessionId: session.sdkSessionId,
		}),
		providerId: session.providerId,
		sdkSessionId: session.sdkSessionId,
		repositoryId: session.repositoryId,
		title: session.title || session.sdkSessionId,
	};
}

export function openBrowserTabState(
	state: TabStateSnapshot,
	tab: Tab,
	options: OpenBrowserTabOptions = {},
): Partial<TabStateSnapshot> {
	if (tab.type === "chat") {
		return { activeTabId: CHAT_TAB.id };
	}
	const exists = state.tabs.some((entry) => entry.id === tab.id);
	const activate = options.activate ?? true;
	return {
		tabs: exists
			? state.tabs.map((entry) => (entry.id === tab.id ? tab : entry))
			: [...state.tabs, tab],
		activeTabId: activate ? tab.id : state.activeTabId,
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
