import { describe, expect, test } from "bun:test";
import {
	formatSessionMenuItem,
	formatTimeAgo,
	sessionMenuChoices,
} from "../../src/frontend/tui/session-menu.ts";

const SESSIONS = [
	{
		sdkSessionId: "sdk-aaa",
		title: "Chat A",
		model: "opus",
		lastActive: Date.now() - 60_000,
	},
	{
		sdkSessionId: "sdk-bbb",
		title: "Chat B",
		model: "sonnet",
		lastActive: Date.now() - 3_600_000,
	},
];

const SESSION_A_LAST_ACTIVE = SESSIONS[0]?.lastActive ?? 0;
const SESSION_B_LAST_ACTIVE = SESSIONS[1]?.lastActive ?? 0;

describe("sessionMenuChoices", () => {
	test("returns sessions with active flag", () => {
		const choices = sessionMenuChoices(SESSIONS, "sdk-aaa");
		expect(choices[0]).toEqual({
			sdkSessionId: "sdk-aaa",
			title: "Chat A",
			model: "opus",
			lastActive: SESSION_A_LAST_ACTIVE,
			active: true,
		});
		expect(choices[1]).toEqual({
			sdkSessionId: "sdk-bbb",
			title: "Chat B",
			model: "sonnet",
			lastActive: SESSION_B_LAST_ACTIVE,
			active: false,
		});
	});

	test("returns empty list when no sessions", () => {
		const choices = sessionMenuChoices([], undefined);
		expect(choices).toEqual([]);
	});

	test("marks no session as active when activeSessionId is undefined", () => {
		const choices = sessionMenuChoices(SESSIONS, undefined);
		expect(choices.every((c) => !c.active)).toBe(true);
	});
});

describe("formatSessionMenuItem", () => {
	test("pads short title to fill width", () => {
		//               "Chat A          1m ago ●"
		const label = formatSessionMenuItem(
			{
				sdkSessionId: "sdk-aaa",
				title: "Chat A",
				model: "opus",
				lastActive: Date.now() - 90_000,
				active: true,
			},
			30,
		);
		expect(label).toBe("Chat A                1m ago ●");
		expect(label.length).toBe(30);
	});

	test("truncates long title with ellipsis", () => {
		const label = formatSessionMenuItem(
			{
				sdkSessionId: "sdk-bbb",
				title: "A very long session title that should be truncated",
				model: "sonnet",
				lastActive: Date.now() - 7_200_000,
				active: false,
			},
			30,
		);
		expect(label.length).toBe(30);
		expect(label).toContain("...");
		expect(label).toMatch(/2h ago$/);
	});

	test("inactive has no marker", () => {
		const label = formatSessionMenuItem(
			{
				sdkSessionId: "sdk-bbb",
				title: "Chat B",
				model: "sonnet",
				lastActive: Date.now() - 3_600_000,
				active: false,
			},
			30,
		);
		expect(label.length).toBe(30);
		expect(label).not.toContain("●");
		expect(label).toMatch(/1h ago$/);
	});

	test("exact width is always respected", () => {
		for (const width of [20, 40, 60, 80]) {
			const label = formatSessionMenuItem(
				{
					sdkSessionId: "sdk-x",
					title: "Title",
					model: "opus",
					lastActive: Date.now(),
					active: true,
				},
				width,
			);
			expect(label.length).toBe(width);
		}
	});
});

describe("formatTimeAgo", () => {
	test("shows seconds for < 1 minute", () => {
		expect(formatTimeAgo(Date.now() - 30_000)).toBe("30s ago");
	});

	test("shows minutes for < 1 hour", () => {
		expect(formatTimeAgo(Date.now() - 300_000)).toBe("5m ago");
	});

	test("shows hours for < 1 day", () => {
		expect(formatTimeAgo(Date.now() - 3_600_000)).toBe("1h ago");
	});

	test("shows days for >= 1 day", () => {
		expect(formatTimeAgo(Date.now() - 86_400_000 * 3)).toBe("3d ago");
	});

	test("shows just now for < 5 seconds", () => {
		expect(formatTimeAgo(Date.now() - 2_000)).toBe("just now");
	});
});
