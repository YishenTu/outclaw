import { describe, expect, test } from "bun:test";
import {
	classifySessionAge,
	groupSessionsByAge,
} from "../../../src/frontend/browser/components/agent-sidebar/group-sessions.ts";
import type { SessionEntry } from "../../../src/frontend/browser/stores/sessions.ts";

const NOW = 1_000_000_000;

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
	test("classifies sessions into today, week, month, and older buckets", () => {
		expect(classifySessionAge(NOW - 1_000, NOW)).toBe("today");
		expect(classifySessionAge(NOW - 2 * 24 * 60 * 60 * 1000, NOW)).toBe("week");
		expect(classifySessionAge(NOW - 10 * 24 * 60 * 60 * 1000, NOW)).toBe(
			"month",
		);
		expect(classifySessionAge(NOW - 40 * 24 * 60 * 60 * 1000, NOW)).toBe(
			"older",
		);
	});

	test("preserves session order within each bucket", () => {
		const grouped = groupSessionsByAge(
			[
				session("today-a", NOW - 1),
				session("week-a", NOW - 2 * 24 * 60 * 60 * 1000),
				session("today-b", NOW - 2),
			],
			NOW,
		);

		expect(grouped.today.map((entry) => entry.sdkSessionId)).toEqual([
			"today-a",
			"today-b",
		]);
		expect(grouped.week.map((entry) => entry.sdkSessionId)).toEqual(["week-a"]);
	});
});
