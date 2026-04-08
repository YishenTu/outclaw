import { describe, expect, mock, test } from "bun:test";
import { HeartbeatScheduler } from "../../../src/runtime/heartbeat/scheduler.ts";

describe("HeartbeatScheduler", () => {
	test("does not read HEARTBEAT.md when runtime says scheduling should be skipped", async () => {
		const readHeartbeatPrompt = mock(async (_homeDir: string) => "unused");
		const requestHeartbeat = mock(
			async (_prompt: string, _scheduledAt: number, _deferMinutes: number) =>
				false,
		);

		const scheduler = new HeartbeatScheduler({
			config: { intervalMinutes: 30, deferMinutes: 5 },
			promptHomeDir: "/tmp/home",
			shouldAttemptHeartbeat: () => false,
			requestHeartbeat,
			readHeartbeatPrompt,
			now: () => 123,
		});

		await scheduler.tick();

		expect(readHeartbeatPrompt).not.toHaveBeenCalled();
		expect(requestHeartbeat).not.toHaveBeenCalled();
	});

	test("reads HEARTBEAT.md and requests heartbeat with scheduler metadata", async () => {
		const requestHeartbeat = mock(
			async (_prompt: string, _scheduledAt: number, _deferMinutes: number) =>
				true,
		);

		const scheduler = new HeartbeatScheduler({
			config: { intervalMinutes: 30, deferMinutes: 7 },
			promptHomeDir: "/tmp/home",
			shouldAttemptHeartbeat: () => true,
			requestHeartbeat,
			readHeartbeatPrompt: async () => "check queue",
			now: () => 456,
		});

		await scheduler.tick();

		expect(requestHeartbeat).toHaveBeenCalledWith("check queue", 456, 7);
	});

	test("starts an interval and clears it on stop", () => {
		let scheduledMs: number | undefined;
		let cleared = false;
		const intervalToken = {} as ReturnType<typeof setInterval>;

		const scheduler = new HeartbeatScheduler({
			config: { intervalMinutes: 30, deferMinutes: 0 },
			promptHomeDir: "/tmp/home",
			shouldAttemptHeartbeat: () => false,
			requestHeartbeat: async () => false,
			readHeartbeatPrompt: async () => undefined,
			setIntervalFn: ((_handler: () => void, timeout?: number) => {
				scheduledMs = timeout;
				return intervalToken;
			}) as typeof setInterval,
			clearIntervalFn: (id) => {
				cleared = id === intervalToken;
			},
		});

		scheduler.start();
		scheduler.stop();

		expect(scheduledMs).toBe(30 * 60_000);
		expect(cleared).toBe(true);
	});
});
