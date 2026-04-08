import { describe, expect, mock, test } from "bun:test";
import { createHeartbeatPrompt } from "../../../src/runtime/heartbeat/create-heartbeat-prompt.ts";
import { HeartbeatScheduler } from "../../../src/runtime/heartbeat/scheduler.ts";

describe("HeartbeatScheduler", () => {
	test("does not request a heartbeat when runtime says scheduling should be skipped", async () => {
		const requestHeartbeat = mock(
			async (_prompt: string, _scheduledAt: number, _deferMinutes: number) =>
				false,
		);

		const scheduler = new HeartbeatScheduler({
			config: { intervalMinutes: 30, deferMinutes: 5 },
			promptHomeDir: "/tmp/home",
			shouldAttemptHeartbeat: () => false,
			requestHeartbeat,
			now: () => 123,
		});

		await scheduler.tick();

		expect(requestHeartbeat).not.toHaveBeenCalled();
	});

	test("builds the wrapper prompt and requests heartbeat with scheduler metadata", async () => {
		const requestHeartbeat = mock(
			async (_prompt: string, _scheduledAt: number, _deferMinutes: number) =>
				true,
		);

		const scheduler = new HeartbeatScheduler({
			config: { intervalMinutes: 30, deferMinutes: 7 },
			promptHomeDir: "/tmp/home",
			shouldAttemptHeartbeat: () => true,
			requestHeartbeat,
			now: () => 456,
		});

		await scheduler.tick();

		expect(requestHeartbeat).toHaveBeenCalledWith(
			createHeartbeatPrompt("/tmp/home"),
			456,
			7,
		);
	});

	test("starts an interval and clears it on stop", () => {
		let intervalHandler: (() => void) | undefined;
		let scheduledMs: number | undefined;
		let cleared = false;
		const intervalToken = {} as ReturnType<typeof setInterval>;
		const requestHeartbeat = mock(
			async (_prompt: string, _scheduledAt: number, _deferMinutes: number) =>
				true,
		);

		const scheduler = new HeartbeatScheduler({
			config: { intervalMinutes: 30, deferMinutes: 0 },
			promptHomeDir: "/tmp/home",
			shouldAttemptHeartbeat: () => true,
			requestHeartbeat,
			now: () => 789,
			setIntervalFn: ((_handler: () => void, timeout?: number) => {
				intervalHandler = _handler;
				scheduledMs = timeout;
				return intervalToken;
			}) as typeof setInterval,
			clearIntervalFn: (id) => {
				cleared = id === intervalToken;
			},
		});

		scheduler.start();
		expect(requestHeartbeat).not.toHaveBeenCalled();
		intervalHandler?.();
		scheduler.stop();

		expect(requestHeartbeat).toHaveBeenCalledWith(
			createHeartbeatPrompt("/tmp/home"),
			789,
			0,
		);
		expect(scheduledMs).toBe(30 * 60_000);
		expect(cleared).toBe(true);
	});
});
