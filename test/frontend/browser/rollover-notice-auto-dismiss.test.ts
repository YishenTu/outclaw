import { afterEach, describe, expect, test, vi } from "bun:test";
import { scheduleRolloverNoticeAutoDismiss } from "../../../src/frontend/browser/use-rollover-notice-auto-dismiss.ts";

describe("rollover notice auto dismiss", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	test("auto-dismisses rollover notices after five seconds", () => {
		vi.useFakeTimers();
		let dismissed = 0;

		const cleanup = scheduleRolloverNoticeAutoDismiss({
			notice: {
				kind: "rollover",
				message: "Previous session auto-finalized after 8h idle.",
			},
			onDismiss: () => {
				dismissed += 1;
			},
		});

		vi.advanceTimersByTime(4_999);
		expect(dismissed).toBe(0);

		vi.advanceTimersByTime(1);
		expect(dismissed).toBe(1);

		cleanup();
	});

	test("does not auto-dismiss restart-required notices", () => {
		vi.useFakeTimers();
		let dismissed = 0;

		const cleanup = scheduleRolloverNoticeAutoDismiss({
			notice: {
				kind: "restart_required",
			},
			onDismiss: () => {
				dismissed += 1;
			},
		});

		vi.advanceTimersByTime(5_000);
		expect(dismissed).toBe(0);

		cleanup();
	});

	test("cleanup cancels a pending rollover auto-dismiss", () => {
		vi.useFakeTimers();
		let dismissed = 0;

		const cleanup = scheduleRolloverNoticeAutoDismiss({
			notice: {
				kind: "rollover",
				message: "Previous session auto-finalized after 8h idle.",
			},
			onDismiss: () => {
				dismissed += 1;
			},
		});

		cleanup();
		vi.advanceTimersByTime(5_000);

		expect(dismissed).toBe(0);
	});
});
