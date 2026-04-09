import { describe, expect, test } from "bun:test";
import {
	buildSessionButtons,
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

	test("returns undefined for unknown prefix", () => {
		expect(parseSessionCallback("xx:something")).toBeUndefined();
	});

	test("returns undefined for empty string", () => {
		expect(parseSessionCallback("")).toBeUndefined();
	});
});
