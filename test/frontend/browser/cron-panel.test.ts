import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import {
	buildFallbackCronEntries,
	CronHistoryList,
	CronPanelHeader,
	formatHistoryTimestamp,
	humanizeCronEntrySchedule,
	humanizeCronSchedule,
	mergeCronHistoryEntries,
	reconcileCronHistoryExpansion,
} from "../../../src/frontend/browser/components/right-panel/cron-panel.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

describe("cron panel helpers", () => {
	test("renders cron columns in a fixed subheader strip", () => {
		const html = renderToStaticMarkup(createElement(CronPanelHeader));

		expect(html).toContain("h-8 shrink-0");
		expect(html).toContain("border-b border-dark-800");
		expect(html).toContain("grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_auto]");
		expect(html).toContain(">Cron<");
		expect(html).toContain(">Frequency<");
		expect(html).toContain("-translate-x-2");
		expect(html).toContain(">On/Off<");
	});

	test("humanizes daily schedules", () => {
		expect(humanizeCronSchedule("15 6 * * *")).toBe("Daily 06:15");
	});

	test("appends timezone to humanized schedules when configured", () => {
		expect(humanizeCronSchedule("13 2 * * *", "UTC")).toBe("Daily 02:13 (UTC)");
	});

	test("humanizes interval schedules", () => {
		expect(humanizeCronSchedule("*/5 * * * *")).toBe("Every 5 min");
	});

	test("humanizes hourly schedules", () => {
		expect(humanizeCronSchedule("0 * * * *")).toBe("Hourly :00");
	});

	test("humanizes multi-hour schedules", () => {
		expect(humanizeCronSchedule("0 */2 * * *")).toBe("Every 2 hr");
	});

	test("humanizes weekday schedules", () => {
		expect(humanizeCronSchedule("30 9 * * 1-5")).toBe("Weekdays 09:30");
	});

	test("humanizes weekly schedules", () => {
		expect(humanizeCronSchedule("0 9 * * 1")).toBe("Weekly Mon 09:00");
	});

	test("humanizes monthly schedules", () => {
		expect(humanizeCronSchedule("0 9 1 * *")).toBe("Monthly day 1 09:00");
	});

	test("humanizes weekly schedules with multiple days", () => {
		expect(humanizeCronSchedule("17 6 * * 2,4,6")).toBe("6:17 Tue/Thur/Sat");
	});

	test("keeps unknown schedules as-is", () => {
		expect(humanizeCronSchedule("0 9 1 1 1,3")).toBe("0 9 1 1 1,3");
	});

	test("humanizes one-time schedules", () => {
		expect(
			humanizeCronEntrySchedule({
				enabled: true,
				name: "Once",
				path: "cron/once.yaml",
				schedule: "2026-04-29T09:00:00+08:00",
				scheduleKind: "once",
				runAt: "2026-04-29T09:00:00+08:00",
				status: "scheduled",
			}),
		).toBe("Once 2026-04-29 09:00 UTC+8");
	});

	test("marks expired one-time schedules", () => {
		expect(
			humanizeCronEntrySchedule({
				enabled: true,
				name: "Expired",
				path: "cron/expired.yaml",
				schedule: "2000-01-23T09:00:00+00:00",
				scheduleKind: "once",
				runAt: "2000-01-23T09:00:00+00:00",
				status: "expired",
			}),
		).toBe("Expired 2000-01-23 09:00 UTC");
	});

	test("formats history timestamps as time, date, year", () => {
		const timestamp = Date.UTC(2026, 4, 2, 13, 5);
		const date = new Date(timestamp);
		const time = date.toLocaleTimeString(undefined, {
			hour: "numeric",
			minute: "2-digit",
		});
		const day = date.toLocaleDateString(undefined, {
			month: "short",
			day: "numeric",
		});
		const year = date.toLocaleDateString(undefined, {
			year: "numeric",
		});

		expect(formatHistoryTimestamp(timestamp)).toBe(`${time}, ${day}, ${year}`);
	});

	test("renders cron history result text as markdown", () => {
		const html = renderToStaticMarkup(
			createElement(CronHistoryList, {
				history: {
					entries: [
						{
							providerId: "claude",
							sessionId: "session-1",
							ranAt: Date.UTC(2026, 4, 2, 13, 5),
							resultText: "**done** and `code`",
						},
					],
					error: null,
					hasMore: false,
					loading: false,
				},
				onLoadMore: () => {},
			}),
		);

		expect(html).toContain("<strong>done</strong>");
		expect(html).toContain("<code>code</code>");
		expect(html).not.toContain("**done**");
		expect(html).not.toContain("`code`");
	});

	test("renders only the newest cron history result expanded by default", () => {
		const html = renderToStaticMarkup(
			createElement(CronHistoryList, {
				history: {
					entries: [
						{
							providerId: "claude",
							sessionId: "new-run",
							ranAt: 300,
							resultText: "**newest** result",
						},
						{
							providerId: "claude",
							sessionId: "older-run",
							ranAt: 200,
							resultText: "older collapsed result",
						},
					],
					error: null,
					hasMore: false,
					loading: false,
				},
				onLoadMore: () => {},
			}),
		);

		expect(html).toContain('aria-expanded="true"');
		expect(html).toContain('aria-expanded="false"');
		expect(html).toContain("<strong>newest</strong>");
		expect(html).not.toContain("older collapsed result");
	});

	test("keeps loaded cron history runs collapsed unless the first run changes", () => {
		const newest = {
			providerId: "claude",
			sessionId: "new-run",
			ranAt: 300,
			resultText: "new",
		};
		const older = {
			providerId: "claude",
			sessionId: "older-run",
			ranAt: 200,
			resultText: "older",
		};
		const live = {
			providerId: "claude",
			sessionId: "live-run",
			ranAt: 400,
			resultText: "live",
		};

		const initial = reconcileCronHistoryExpansion(
			{ autoExpandedFirstKey: null, expandedKeys: [] },
			[newest],
		);
		expect(initial).toEqual({
			autoExpandedFirstKey: "claude:new-run",
			expandedKeys: ["claude:new-run"],
		});

		expect(reconcileCronHistoryExpansion(initial, [newest, older])).toEqual({
			autoExpandedFirstKey: "claude:new-run",
			expandedKeys: ["claude:new-run"],
		});

		const collapsedByUser = {
			autoExpandedFirstKey: "claude:new-run",
			expandedKeys: [],
		};
		expect(
			reconcileCronHistoryExpansion(collapsedByUser, [newest, older]),
		).toEqual({
			autoExpandedFirstKey: "claude:new-run",
			expandedKeys: [],
		});
		expect(
			reconcileCronHistoryExpansion(collapsedByUser, [live, newest, older]),
		).toEqual({
			autoExpandedFirstKey: "claude:live-run",
			expandedKeys: ["claude:live-run"],
		});
	});

	test("preserves existing cron history entries when a first page response arrives later", () => {
		expect(
			mergeCronHistoryEntries(
				[
					{
						providerId: "claude",
						sessionId: "live-run",
						ranAt: 300,
						resultText: "live result",
					},
				],
				[
					{
						providerId: "claude",
						sessionId: "older-run",
						ranAt: 200,
						resultText: "older result",
					},
				],
			),
		).toEqual([
			{
				providerId: "claude",
				sessionId: "live-run",
				ranAt: 300,
				resultText: "live result",
			},
			{
				providerId: "claude",
				sessionId: "older-run",
				ranAt: 200,
				resultText: "older result",
			},
		]);
	});

	test("keeps existing cron result text when the fetched page returns the same run", () => {
		expect(
			mergeCronHistoryEntries(
				[
					{
						providerId: "claude",
						sessionId: "same-run",
						ranAt: 300,
						resultText: "[error] live failure",
					},
				],
				[
					{
						providerId: "claude",
						sessionId: "same-run",
						ranAt: 300,
						resultText: "",
					},
				],
			),
		).toEqual([
			{
				providerId: "claude",
				sessionId: "same-run",
				ranAt: 300,
				resultText: "[error] live failure",
			},
		]);
	});

	test("fallback entries exclude template cron yaml files", () => {
		expect(
			buildFallbackCronEntries([
				{
					children: [
						{
							kind: "file",
							name: "_template.yaml",
							path: "cron/_template.yaml",
						},
						{
							kind: "file",
							name: "daily.yaml",
							path: "cron/daily.yaml",
						},
					],
					kind: "directory",
					name: "cron",
					path: "cron",
				},
			]),
		).toEqual([
			{
				name: "daily.yaml",
				path: "cron/daily.yaml",
				schedule: "Schedule unavailable",
				scheduleKind: "recurring",
				enabled: true,
				status: "scheduled",
			},
		]);
	});
});
