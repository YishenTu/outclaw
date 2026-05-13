import { describe, expect, test } from "bun:test";
import {
	activateBrowserTabState,
	CHAT_TAB,
	closeAllBrowserFileTabsState,
	closeBrowserTabState,
	openBrowserTabState,
	setBrowserTabScrollPositionState,
} from "../../../src/frontend/browser/stores/tab-policy.ts";
import type { Tab } from "../../../src/frontend/browser/stores/tabs.ts";

const FILE_TAB: Tab = {
	type: "file",
	id: "agent-a:README.md",
	agentId: "agent-a",
	path: "README.md",
};

const DIFF_TAB: Tab = {
	type: "git-diff",
	id: "git-diff:README.md",
	path: "README.md",
};

const CODING_TAB: Tab = {
	type: "coding-session",
	id: "coding:repo-1:codex:code-1",
	providerId: "codex",
	sdkSessionId: "code-1",
	repositoryId: "repo-1",
	title: "Fix tests",
};

describe("browser tab policy", () => {
	test("opens new tabs once and activates existing tabs", () => {
		const first = openBrowserTabState(
			{ tabs: [CHAT_TAB], activeTabId: "chat", scrollPositions: {} },
			FILE_TAB,
		);
		expect(first).toEqual({
			tabs: [CHAT_TAB, FILE_TAB],
			activeTabId: FILE_TAB.id,
		});

		expect(
			openBrowserTabState(
				{
					tabs: [CHAT_TAB, FILE_TAB],
					activeTabId: FILE_TAB.id,
					scrollPositions: {},
				},
				FILE_TAB,
			),
		).toEqual({
			tabs: [CHAT_TAB, FILE_TAB],
			activeTabId: FILE_TAB.id,
		});
	});

	test("closes tabs with active fallback and scroll cleanup", () => {
		expect(
			closeBrowserTabState(
				{
					tabs: [CHAT_TAB, FILE_TAB, DIFF_TAB],
					activeTabId: DIFF_TAB.id,
					scrollPositions: {
						[DIFF_TAB.id]: 120,
						[FILE_TAB.id]: 40,
					},
				},
				DIFF_TAB.id,
			),
		).toEqual({
			tabs: [CHAT_TAB, FILE_TAB],
			activeTabId: FILE_TAB.id,
			scrollPositions: {
				[FILE_TAB.id]: 40,
			},
		});
	});

	test("keeps chat tab permanent and ignores missing active tab ids", () => {
		const state = {
			tabs: [CHAT_TAB],
			activeTabId: "chat",
			scrollPositions: {},
		};
		expect(closeBrowserTabState(state, "chat")).toBe(state);
		expect(activateBrowserTabState(state, "missing")).toBe(state);
	});

	test("clears file tabs and tracks scroll positions", () => {
		expect(closeAllBrowserFileTabsState()).toEqual({
			tabs: [CHAT_TAB],
			activeTabId: "chat",
			scrollPositions: {},
		});
		expect(
			setBrowserTabScrollPositionState(
				{ tabs: [CHAT_TAB], activeTabId: "chat", scrollPositions: {} },
				"chat",
				32,
			),
		).toEqual({ scrollPositions: { chat: 32 } });
	});

	test("opens linked coding tabs in the background until explicitly activated", () => {
		expect(
			openBrowserTabState(
				{ tabs: [CHAT_TAB], activeTabId: "chat", scrollPositions: {} },
				CODING_TAB,
				{ activate: false },
			),
		).toEqual({
			tabs: [CHAT_TAB, CODING_TAB],
			activeTabId: "chat",
		});

		expect(
			openBrowserTabState(
				{
					tabs: [CHAT_TAB, CODING_TAB],
					activeTabId: "chat",
					scrollPositions: {},
				},
				{ ...CODING_TAB, title: "Updated title" },
				{ activate: false },
			),
		).toEqual({
			tabs: [CHAT_TAB, { ...CODING_TAB, title: "Updated title" }],
			activeTabId: "chat",
		});

		expect(
			openBrowserTabState(
				{
					tabs: [CHAT_TAB, CODING_TAB],
					activeTabId: "chat",
					scrollPositions: {},
				},
				CODING_TAB,
			),
		).toEqual({
			tabs: [CHAT_TAB, CODING_TAB],
			activeTabId: CODING_TAB.id,
		});
	});
});
