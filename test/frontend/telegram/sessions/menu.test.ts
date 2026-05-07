import { describe, expect, test } from "bun:test";
import {
	buildSessionButtons,
	buildSessionPageView,
	extractSearchQueryFromSessionPageText,
	formatTimeCompact,
	parseSessionCallback,
} from "../../../../src/frontend/telegram/sessions/menu.ts";

const SESSIONS = [
	{
		sdkSessionId: "sdk-aaa",
		title: "Chat A",
		lastActive: Date.now() - 60_000,
	},
	{
		sdkSessionId: "sdk-bbb",
		title: "Chat B",
		lastActive: Date.now() - 3_600_000,
	},
];

describe("buildSessionButtons", () => {
	test("returns a row per session with label and callback data", () => {
		const rows = buildSessionButtons(SESSIONS, "sdk-aaa");
		expect(rows).toHaveLength(2);
		expect(rows[0]?.switchData).toBe("ss:sdk-aaa");
		expect(rows[1]?.switchData).toBe("ss:sdk-bbb");
	});

	test("label has title with active marker", () => {
		const rows = buildSessionButtons(SESSIONS, "sdk-aaa");
		expect(rows[0]?.label).toBe("Chat A ●");
		expect(rows[1]?.label).toBe("Chat B");
	});

	test("returns empty array for no sessions", () => {
		expect(buildSessionButtons([], undefined)).toEqual([]);
	});
});

describe("formatTimeCompact", () => {
	test("drops ago suffix", () => {
		expect(formatTimeCompact(Date.now() - 300_000)).toBe("5m");
		expect(formatTimeCompact(Date.now() - 3_600_000)).toBe("1h");
		expect(formatTimeCompact(Date.now() - 86_400_000 * 2)).toBe("2d");
	});

	test("shows now for recent", () => {
		expect(formatTimeCompact(Date.now() - 2_000)).toBe("now");
	});
});

describe("parseSessionCallback", () => {
	test("parses switch callback", () => {
		expect(parseSessionCallback("ss:sdk-aaa")).toEqual({
			type: "switch",
			sdkSessionId: "sdk-aaa",
		});
	});

	test("parses page and noop callbacks", () => {
		expect(parseSessionCallback("sl:2")).toEqual({
			type: "page",
			mode: "list",
			page: 2,
		});
		expect(parseSessionCallback("sq:3")).toEqual({
			type: "page",
			mode: "search",
			page: 3,
		});
		expect(parseSessionCallback("sn")).toEqual({ type: "noop" });
	});

	test("returns undefined for unknown prefix", () => {
		expect(parseSessionCallback("xx:something")).toBeUndefined();
	});

	test("returns undefined for empty string", () => {
		expect(parseSessionCallback("")).toBeUndefined();
	});
});

describe("buildSessionPageView", () => {
	test("renders five sessions per page with next navigation", () => {
		const sessions = Array.from({ length: 6 }, (_value, index) => ({
			sdkSessionId: `sdk-${index}`,
			title: `Chat ${index}`,
			lastActive: Date.now() - index,
		}));

		const view = buildSessionPageView({
			activeSessionId: "sdk-0",
			mode: "list",
			nextCursor: { lastActive: 1, sdkSessionId: "sdk-5" },
			page: 0,
			sessions,
		});

		expect(view.text).toContain("Sessions:");
		expect(view.text).toContain("Chat 0");
		expect(view.text).not.toContain("Chat 5");
		expect(view.rows.at(-1)).toEqual([
			{ label: "1/2+", data: "sn" },
			{ label: "Next", data: "sl:1" },
		]);
	});

	test("renders search headers and extracts the query from message text", () => {
		const view = buildSessionPageView({
			mode: "search",
			page: 1,
			query: "auth   middle",
			sessions: [
				{
					sdkSessionId: "sdk-0",
					title: "Auth middleware",
					lastActive: Date.now(),
				},
			],
		});

		expect(view.text).toStartWith("Session search: auth middle");
		expect(extractSearchQueryFromSessionPageText(view.text)).toBe(
			"auth middle",
		);
		expect(view.rows.at(-1)).toEqual([
			{ label: "Prev", data: "sq:0" },
			{ label: "2/2", data: "sn" },
		]);
	});
});
