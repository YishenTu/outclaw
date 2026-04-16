import { describe, expect, test } from "bun:test";
import { humanizeCronSchedule } from "../../../src/frontend/browser/components/right-panel/cron-panel.tsx";

describe("cron panel helpers", () => {
	test("humanizes daily schedules", () => {
		expect(humanizeCronSchedule("15 6 * * *")).toBe("6:15 daily");
	});

	test("humanizes interval schedules", () => {
		expect(humanizeCronSchedule("*/5 * * * *")).toBe("Every 5 minutes");
	});

	test("keeps unknown schedules as-is", () => {
		expect(humanizeCronSchedule("0 9 * * 1")).toBe("0 9 * * 1");
	});
});
