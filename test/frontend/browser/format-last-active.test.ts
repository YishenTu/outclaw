import { describe, expect, test } from "bun:test";
import { formatLastActive } from "../../../src/frontend/browser/components/agent-sidebar/format-last-active.ts";

describe("formatLastActive", () => {
	test("shows now for very recent activity", () => {
		expect(formatLastActive(98_000, 100_000)).toBe("1m");
	});

	test("shows minutes for activity under one minute", () => {
		expect(formatLastActive(70_000, 100_000)).toBe("1m");
	});

	test("shows minutes for activity under one hour", () => {
		expect(formatLastActive(40_000, 100_000)).toBe("1m");
		expect(formatLastActive(100_000 - 5 * 60_000, 100_000)).toBe("5m");
	});

	test("shows hours for activity under one day", () => {
		expect(formatLastActive(100_000 - 3_600_000, 100_000)).toBe("1h");
	});

	test("shows days for activity over one day", () => {
		expect(formatLastActive(100_000 - 3 * 86_400_000, 100_000)).toBe("3d");
	});

	test("clamps future activity to now", () => {
		expect(formatLastActive(105_000, 100_000)).toBe("1m");
	});
});
