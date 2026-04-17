import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import {
	CronPanelHeader,
	humanizeCronSchedule,
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

	test("keeps unknown schedules as-is", () => {
		expect(humanizeCronSchedule("0 9 * * 1,3")).toBe("0 9 * * 1,3");
	});
});
