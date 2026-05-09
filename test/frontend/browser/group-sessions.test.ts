import { describe, expect, test } from "bun:test";
import {
	classifySessionAge,
	groupSessionsByAge,
} from "../../../src/frontend/browser/components/agent-sidebar/group-sessions.ts";
import type { SessionEntry } from "../../../src/frontend/browser/stores/sessions.ts";

function localTime(
	year: number,
	month: number,
	day: number,
	hour = 12,
): number {
	return new Date(year, month - 1, day, hour, 0).getTime();
}

function session(id: string, lastActive: number): SessionEntry {
	return {
		agentId: "agent-a",
		providerId: "claude",
		sdkSessionId: id,
		title: id,
		model: "sonnet",
		lastActive,
	};
}

describe("groupSessionsByAge", () => {
	test("classifies sessions into today, last-seven-days, last-thirty-days, and older buckets", () => {
		const now = localTime(2026, 5, 9, 8);

		expect(classifySessionAge(localTime(2026, 5, 9, 7), now)).toBe("today");
		expect(classifySessionAge(localTime(2026, 5, 8, 21), now)).toBe(
			"lastSevenDays",
		);
		expect(classifySessionAge(localTime(2026, 5, 1, 21), now)).toBe(
			"lastThirtyDays",
		);
		expect(classifySessionAge(localTime(2026, 4, 26, 21), now)).toBe(
			"lastThirtyDays",
		);
		expect(classifySessionAge(localTime(2026, 4, 8, 21), now)).toBe("older");
	});

	test("uses rolling elapsed age instead of calendar boundaries", () => {
		const now = localTime(2026, 5, 9, 8);
		const lastNight = localTime(2026, 5, 8, 21);
		const lastMonthWithinThirtyDays = localTime(2026, 4, 26, 21);
		const sameMonthOutsideSevenDays = localTime(2026, 5, 1, 21);

		expect(classifySessionAge(lastNight, now)).toBe("lastSevenDays");
		expect(classifySessionAge(lastMonthWithinThirtyDays, now)).toBe(
			"lastThirtyDays",
		);
		expect(classifySessionAge(sameMonthOutsideSevenDays, now)).toBe(
			"lastThirtyDays",
		);
	});

	test("preserves session order within each bucket", () => {
		const now = localTime(2026, 5, 9, 8);
		const grouped = groupSessionsByAge(
			[
				session("today-a", localTime(2026, 5, 9, 7)),
				session("week-a", localTime(2026, 5, 8, 21)),
				session("today-b", localTime(2026, 5, 9, 6)),
			],
			now,
		);

		expect(grouped.today.map((entry) => entry.sdkSessionId)).toEqual([
			"today-a",
			"today-b",
		]);
		expect(grouped.lastSevenDays.map((entry) => entry.sdkSessionId)).toEqual([
			"week-a",
		]);
	});
});
