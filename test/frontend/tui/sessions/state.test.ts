import { describe, expect, test } from "bun:test";
import {
	applySessionEventToMenuData,
	shouldEnableGlobalStopShortcut,
} from "../../../../src/frontend/tui/sessions/state.ts";
import type { SessionMenuData } from "../../../../src/frontend/tui/sessions/types.ts";

const MENU_DATA: SessionMenuData = {
	activeSessionId: "sdk-active",
	sessions: [
		{
			sdkSessionId: "sdk-active",
			title: "Active chat",
			model: "opus",
			lastActive: 1000,
		},
		{
			sdkSessionId: "sdk-other",
			title: "Other chat",
			model: "sonnet",
			lastActive: 900,
		},
	],
};

describe("TUI session state", () => {
	test("updates menu titles from session_renamed events", () => {
		expect(
			applySessionEventToMenuData(MENU_DATA, {
				type: "session_renamed",
				sdkSessionId: "sdk-other",
				title: "Renamed chat",
			}),
		).toEqual({
			activeSessionId: "sdk-active",
			sessions: [
				{
					sdkSessionId: "sdk-active",
					title: "Active chat",
					model: "opus",
					lastActive: 1000,
				},
				{
					sdkSessionId: "sdk-other",
					title: "Renamed chat",
					model: "sonnet",
					lastActive: 900,
				},
			],
		});
	});

	test("removes deleted sessions and clears the active marker on session_cleared", () => {
		const deleted = applySessionEventToMenuData(MENU_DATA, {
			type: "session_deleted",
			sdkSessionId: "sdk-active",
		});

		expect(deleted).toEqual({
			activeSessionId: undefined,
			sessions: [
				{
					sdkSessionId: "sdk-other",
					title: "Other chat",
					model: "sonnet",
					lastActive: 900,
				},
			],
		});
		expect(
			applySessionEventToMenuData(deleted, {
				type: "session_cleared",
			}),
		).toEqual({
			activeSessionId: undefined,
			sessions: [
				{
					sdkSessionId: "sdk-other",
					title: "Other chat",
					model: "sonnet",
					lastActive: 900,
				},
			],
		});
	});

	test("tracks the active session across switch events", () => {
		expect(
			applySessionEventToMenuData(MENU_DATA, {
				type: "session_switched",
				sdkSessionId: "sdk-other",
				title: "Other chat",
			}),
		).toEqual({
			activeSessionId: "sdk-other",
			sessions: MENU_DATA.sessions,
		});
	});

	test("appends paginated session_list events and replaces with search results", () => {
		const appended = applySessionEventToMenuData(MENU_DATA, {
			type: "session_list",
			activeSessionId: "sdk-active",
			nextCursor: { lastActive: 800, sdkSessionId: "sdk-third" },
			sessions: [
				{
					sdkSessionId: "sdk-other",
					title: "Other chat",
					model: "sonnet",
					lastActive: 900,
				},
				{
					sdkSessionId: "sdk-third",
					title: "Third chat",
					model: "haiku",
					lastActive: 800,
				},
			],
		});

		expect(appended).toMatchObject({
			activeSessionId: "sdk-active",
			nextCursor: { lastActive: 800, sdkSessionId: "sdk-third" },
			sessions: [
				MENU_DATA.sessions[0],
				MENU_DATA.sessions[1],
				{
					sdkSessionId: "sdk-third",
					title: "Third chat",
					model: "haiku",
					lastActive: 800,
				},
			],
		});

		expect(
			applySessionEventToMenuData(appended, {
				type: "session_search_result",
				query: "third",
				sessions: [
					{
						sdkSessionId: "sdk-third",
						title: "Third chat",
						model: "haiku",
						lastActive: 800,
					},
				],
			}),
		).toEqual({
			activeSessionId: "sdk-active",
			nextCursor: undefined,
			searchQuery: "third",
			sessions: [
				{
					sdkSessionId: "sdk-third",
					title: "Third chat",
					model: "haiku",
					lastActive: 800,
				},
			],
		});

		expect(
			applySessionEventToMenuData(null, {
				type: "session_search_result",
				query: "third",
				nextCursor: { lastActive: 700, sdkSessionId: "sdk-fourth" },
				sessions: [
					{
						sdkSessionId: "sdk-third",
						title: "Third chat",
						model: "haiku",
						lastActive: 800,
					},
				],
			}),
		).toEqual({
			nextCursor: { lastActive: 700, sdkSessionId: "sdk-fourth" },
			searchQuery: "third",
			sessions: [
				{
					sdkSessionId: "sdk-third",
					title: "Third chat",
					model: "haiku",
					lastActive: 800,
				},
			],
		});

		expect(
			applySessionEventToMenuData(
				{
					activeSessionId: "sdk-active",
					searchQuery: "third",
					nextCursor: { lastActive: 700, sdkSessionId: "sdk-fourth" },
					sessions: [
						{
							sdkSessionId: "sdk-third",
							title: "Third chat",
							model: "haiku",
							lastActive: 800,
						},
					],
				},
				{
					type: "session_search_result",
					query: "third",
					sessions: [
						{
							sdkSessionId: "sdk-fourth",
							title: "Fourth chat",
							model: "sonnet",
							lastActive: 700,
						},
					],
				},
			),
		).toEqual({
			activeSessionId: "sdk-active",
			nextCursor: undefined,
			searchQuery: "third",
			sessions: [
				{
					sdkSessionId: "sdk-third",
					title: "Third chat",
					model: "haiku",
					lastActive: 800,
				},
				{
					sdkSessionId: "sdk-fourth",
					title: "Fourth chat",
					model: "sonnet",
					lastActive: 700,
				},
			],
		});
	});

	test("disables the global stop shortcut while the menu is visible", () => {
		expect(shouldEnableGlobalStopShortcut(true, false)).toBe(true);
		expect(shouldEnableGlobalStopShortcut(true, true)).toBe(false);
		expect(shouldEnableGlobalStopShortcut(false, false)).toBe(false);
	});
});
