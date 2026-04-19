import { describe, expect, mock, test } from "bun:test";
import { RolloverScheduler } from "../../../src/runtime/rollover/scheduler.ts";

const noopClear = () => {};

describe("RolloverScheduler", () => {
	test("requests rollover immediately when the agent is overdue and a session is active", () => {
		const requestRollover = mock((_prompt: string) => true);
		const scheduler = new RolloverScheduler({
			config: { idleMinutes: 60 },
			now: () => 4_000_000,
			getLastInteractiveAt: () => 0,
			getLastHandledInteractiveAt: () => undefined,
			hasActiveRun: () => false,
			hasActiveSession: () => true,
			requestRollover,
			setTimeoutFn: () => ({}) as ReturnType<typeof setTimeout>,
			clearTimeoutFn: noopClear,
		});

		scheduler.start();

		expect(requestRollover).toHaveBeenCalledTimes(1);
	});

	test("does not request rollover while overdue if no session is active, but retries on later state change", () => {
		const requestRollover = mock((_prompt: string) => true);
		let hasActiveSession = false;
		const scheduler = new RolloverScheduler({
			config: { idleMinutes: 60 },
			now: () => 4_000_000,
			getLastInteractiveAt: () => 0,
			getLastHandledInteractiveAt: () => undefined,
			hasActiveRun: () => false,
			hasActiveSession: () => hasActiveSession,
			requestRollover,
			setTimeoutFn: () => ({}) as ReturnType<typeof setTimeout>,
			clearTimeoutFn: noopClear,
		});

		scheduler.start();
		expect(requestRollover).not.toHaveBeenCalled();

		hasActiveSession = true;
		scheduler.noteStateChanged();
		expect(requestRollover).toHaveBeenCalledTimes(1);
	});

	test("does not request rollover again for the same interactive idle epoch after completion", () => {
		const requestRollover = mock((_prompt: string) => true);
		let handledInteractiveAt: number | undefined;
		const scheduler = new RolloverScheduler({
			config: { idleMinutes: 60 },
			now: () => 4_000_000,
			getLastInteractiveAt: () => 0,
			getLastHandledInteractiveAt: () => handledInteractiveAt,
			hasActiveRun: () => false,
			hasActiveSession: () => true,
			requestRollover,
			setTimeoutFn: () => ({}) as ReturnType<typeof setTimeout>,
			clearTimeoutFn: noopClear,
		});

		scheduler.start();
		expect(requestRollover).toHaveBeenCalledTimes(1);

		handledInteractiveAt = 0;
		scheduler.noteStateChanged();

		expect(requestRollover).toHaveBeenCalledTimes(1);
	});
});
