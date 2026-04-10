import { describe, expect, mock, test } from "bun:test";
import { createHeartbeatPrompt } from "../../../src/runtime/heartbeat/create-heartbeat-prompt.ts";
import { HeartbeatScheduler } from "../../../src/runtime/heartbeat/scheduler.ts";

const noop = () => ({}) as ReturnType<typeof setTimeout>;
const noopClear = () => {};

describe("HeartbeatScheduler", () => {
	test("does not request a heartbeat when runtime says scheduling should be skipped", async () => {
		const requestHeartbeat = mock(
			async (_prompt: string, _scheduledAt: number, _deferMinutes: number) =>
				false,
		);

		const scheduler = new HeartbeatScheduler({
			config: { intervalMinutes: 30, deferMinutes: 5 },
			promptHomeDir: "/tmp/home",
			shouldAttemptHeartbeat: () => "skip",
			requestHeartbeat,
			now: () => 123,
			setTimeoutFn: noop,
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
			shouldAttemptHeartbeat: () => "attempt",
			requestHeartbeat,
			now: () => 456,
			setTimeoutFn: noop,
		});

		await scheduler.tick();

		expect(requestHeartbeat).toHaveBeenCalledWith(
			createHeartbeatPrompt("/tmp/home"),
			456,
			7,
		);
	});

	test("nextHeartbeatAt is undefined before start", () => {
		const scheduler = new HeartbeatScheduler({
			config: { intervalMinutes: 30, deferMinutes: 0 },
			promptHomeDir: "/tmp/home",
			shouldAttemptHeartbeat: () => "attempt",
			requestHeartbeat: async () => true,
			now: () => 1000,
		});

		expect(scheduler.nextHeartbeatAt).toBeUndefined();
	});

	test("nextHeartbeatAt is set on start", () => {
		const scheduler = new HeartbeatScheduler({
			config: { intervalMinutes: 30, deferMinutes: 0 },
			promptHomeDir: "/tmp/home",
			shouldAttemptHeartbeat: () => "attempt",
			requestHeartbeat: async () => true,
			now: () => 1000,
			setTimeoutFn: noop,
		});

		scheduler.start();
		expect(scheduler.nextHeartbeatAt).toBe(1000 + 30 * 60_000);
	});

	test("nextHeartbeatAt advances after successful tick", async () => {
		let currentTime = 1000;
		const scheduler = new HeartbeatScheduler({
			config: { intervalMinutes: 30, deferMinutes: 0 },
			promptHomeDir: "/tmp/home",
			shouldAttemptHeartbeat: () => "attempt",
			requestHeartbeat: async () => true,
			now: () => currentTime,
			setTimeoutFn: noop,
		});

		scheduler.start();
		expect(scheduler.nextHeartbeatAt).toBe(1000 + 30 * 60_000);

		currentTime = 1000 + 30 * 60_000;
		await scheduler.tick();
		expect(scheduler.nextHeartbeatAt).toBe(currentTime + 30 * 60_000);
	});

	test("nextHeartbeatAt is cleared on stop", () => {
		const scheduler = new HeartbeatScheduler({
			config: { intervalMinutes: 30, deferMinutes: 0 },
			promptHomeDir: "/tmp/home",
			shouldAttemptHeartbeat: () => "attempt",
			requestHeartbeat: async () => true,
			now: () => 1000,
			setTimeoutFn: noop,
			clearTimeoutFn: noopClear,
		});

		scheduler.start();
		expect(scheduler.nextHeartbeatAt).toBeDefined();

		scheduler.stop();
		expect(scheduler.nextHeartbeatAt).toBeUndefined();
	});

	test("nextHeartbeatAt is undefined when intervalMinutes is 0", () => {
		const scheduler = new HeartbeatScheduler({
			config: { intervalMinutes: 0, deferMinutes: 0 },
			promptHomeDir: "/tmp/home",
			shouldAttemptHeartbeat: () => "attempt",
			requestHeartbeat: async () => true,
			now: () => 1000,
		});

		scheduler.start();
		expect(scheduler.nextHeartbeatAt).toBeUndefined();
	});

	test("notifies listeners on status changes", async () => {
		let currentTime = 1000;
		let callCount = 0;
		const scheduler = new HeartbeatScheduler({
			config: { intervalMinutes: 30, deferMinutes: 0 },
			promptHomeDir: "/tmp/home",
			shouldAttemptHeartbeat: () => "attempt",
			requestHeartbeat: async () => true,
			now: () => currentTime,
			onStatusChange: () => {
				callCount++;
			},
			setTimeoutFn: noop,
			clearTimeoutFn: noopClear,
		});

		scheduler.start(); // nextHeartbeatAt set → notify
		expect(callCount).toBe(1);

		currentTime = 1000 + 30 * 60_000;
		await scheduler.tick(); // nextHeartbeatAt updated → notify
		expect(callCount).toBe(2);

		scheduler.stop(); // nextHeartbeatAt cleared → notify
		expect(callCount).toBe(3);
	});

	describe("deferral", () => {
		test("deferred is false before any tick", () => {
			const scheduler = new HeartbeatScheduler({
				config: { intervalMinutes: 30, deferMinutes: 5 },
				promptHomeDir: "/tmp/home",
				shouldAttemptHeartbeat: () => "attempt",
				requestHeartbeat: async () => true,
				now: () => 1000,
				setTimeoutFn: noop,
			});

			scheduler.start();
			expect(scheduler.deferred).toBe(false);
		});

		test("deferred is true when tick is deferred", async () => {
			const scheduler = new HeartbeatScheduler({
				config: { intervalMinutes: 30, deferMinutes: 5 },
				promptHomeDir: "/tmp/home",
				shouldAttemptHeartbeat: () => "defer",
				requestHeartbeat: async () => true,
				now: () => 1000,
				setTimeoutFn: noop,
			});

			scheduler.start();
			await scheduler.tick();
			expect(scheduler.deferred).toBe(true);
		});

		test("calls onDeferred when tick is deferred", async () => {
			const onDeferred = mock((_deferMinutes: number) => {});

			const scheduler = new HeartbeatScheduler({
				config: { intervalMinutes: 30, deferMinutes: 5 },
				promptHomeDir: "/tmp/home",
				shouldAttemptHeartbeat: () => "defer",
				requestHeartbeat: async () => true,
				onDeferred,
				now: () => 1000,
				setTimeoutFn: noop,
			});

			scheduler.start();
			await scheduler.tick();

			expect(onDeferred).toHaveBeenCalledWith(5);
		});

		test("does not schedule next timer when deferred", async () => {
			const scheduled: number[] = [];
			const scheduler = new HeartbeatScheduler({
				config: { intervalMinutes: 30, deferMinutes: 5 },
				promptHomeDir: "/tmp/home",
				shouldAttemptHeartbeat: () => "defer",
				requestHeartbeat: async () => true,
				now: () => 1000,
				setTimeoutFn: (_handler, timeout) => {
					scheduled.push(timeout);
					return {} as ReturnType<typeof setTimeout>;
				},
				clearTimeoutFn: noopClear,
			});

			scheduler.start(); // schedules initial timer
			const countAfterStart = scheduled.length;

			await scheduler.tick(); // deferred — should NOT schedule another timer
			expect(scheduled.length).toBe(countAfterStart);
		});

		test("fireDeferred fires the heartbeat and schedules next tick", async () => {
			const requestHeartbeat = mock(
				async (_prompt: string, _scheduledAt: number, _deferMinutes: number) =>
					true,
			);
			const scheduled: number[] = [];

			const scheduler = new HeartbeatScheduler({
				config: { intervalMinutes: 30, deferMinutes: 5 },
				promptHomeDir: "/tmp/home",
				shouldAttemptHeartbeat: () => "defer",
				requestHeartbeat,
				now: () => 1000,
				setTimeoutFn: (_handler, timeout) => {
					scheduled.push(timeout);
					return {} as ReturnType<typeof setTimeout>;
				},
				clearTimeoutFn: noopClear,
			});

			scheduler.start();
			await scheduler.tick(); // enters deferred state

			expect(scheduler.deferred).toBe(true);
			expect(requestHeartbeat).not.toHaveBeenCalled();

			await scheduler.fireDeferred();

			expect(scheduler.deferred).toBe(false);
			expect(requestHeartbeat).toHaveBeenCalledTimes(1);
			expect(scheduler.nextHeartbeatAt).toBe(1000 + 30 * 60_000);
			// Should have scheduled the next tick
			expect(scheduled.at(-1)).toBe(30 * 60_000);
		});

		test("deferred resets to false when tick succeeds", async () => {
			let result: "attempt" | "skip" | "defer" = "defer";
			const scheduler = new HeartbeatScheduler({
				config: { intervalMinutes: 30, deferMinutes: 5 },
				promptHomeDir: "/tmp/home",
				shouldAttemptHeartbeat: () => result,
				requestHeartbeat: async () => true,
				now: () => 1000,
				setTimeoutFn: noop,
			});

			scheduler.start();
			await scheduler.tick();
			expect(scheduler.deferred).toBe(true);

			result = "attempt";
			await scheduler.tick();
			expect(scheduler.deferred).toBe(false);
		});

		test("deferred is false when tick is skipped (not deferred)", async () => {
			const scheduler = new HeartbeatScheduler({
				config: { intervalMinutes: 30, deferMinutes: 5 },
				promptHomeDir: "/tmp/home",
				shouldAttemptHeartbeat: () => "skip",
				requestHeartbeat: async () => true,
				now: () => 1000,
				setTimeoutFn: noop,
			});

			scheduler.start();
			await scheduler.tick();
			expect(scheduler.deferred).toBe(false);
		});

		test("deferred is cleared on stop", async () => {
			const scheduler = new HeartbeatScheduler({
				config: { intervalMinutes: 30, deferMinutes: 5 },
				promptHomeDir: "/tmp/home",
				shouldAttemptHeartbeat: () => "defer",
				requestHeartbeat: async () => true,
				now: () => 1000,
				setTimeoutFn: noop,
				clearTimeoutFn: noopClear,
			});

			scheduler.start();
			await scheduler.tick();
			expect(scheduler.deferred).toBe(true);

			scheduler.stop();
			expect(scheduler.deferred).toBe(false);
		});

		test("fireDeferred keeps polling when heartbeat content disappears", async () => {
			let hasContent = true;
			const scheduled: number[] = [];
			const scheduler = new HeartbeatScheduler({
				config: { intervalMinutes: 30, deferMinutes: 5 },
				promptHomeDir: "/tmp/home",
				shouldAttemptHeartbeat: () => "defer",
				requestHeartbeat: async () => true,
				hasHeartbeatContent: () => hasContent,
				now: () => 1000,
				setTimeoutFn: (_handler, timeout) => {
					scheduled.push(timeout);
					return {} as ReturnType<typeof setTimeout>;
				},
				clearTimeoutFn: noopClear,
			});

			scheduler.start();
			await scheduler.tick();
			const scheduledCountAfterDefer = scheduled.length;
			hasContent = false;

			await scheduler.fireDeferred();

			expect(scheduler.deferred).toBe(false);
			expect(scheduler.nextHeartbeatAt).toBeUndefined();
			expect(scheduled.length).toBe(scheduledCountAfterDefer + 1);
			expect(scheduled.at(-1)).toBe(30 * 60_000);
		});
	});

	describe("heartbeat content check", () => {
		test("skips tick and clears nextHeartbeatAt when heartbeat file has no content", async () => {
			const requestHeartbeat = mock(
				async (_prompt: string, _scheduledAt: number, _deferMinutes: number) =>
					true,
			);

			const scheduler = new HeartbeatScheduler({
				config: { intervalMinutes: 30, deferMinutes: 0 },
				promptHomeDir: "/tmp/home",
				shouldAttemptHeartbeat: () => "attempt",
				requestHeartbeat,
				hasHeartbeatContent: () => false,
				now: () => 1000,
				setTimeoutFn: noop,
			});

			scheduler.start();
			await scheduler.tick();

			expect(requestHeartbeat).not.toHaveBeenCalled();
			expect(scheduler.nextHeartbeatAt).toBeUndefined();
		});

		test("does not set nextHeartbeatAt on start when heartbeat file has no content", () => {
			const scheduler = new HeartbeatScheduler({
				config: { intervalMinutes: 30, deferMinutes: 0 },
				promptHomeDir: "/tmp/home",
				shouldAttemptHeartbeat: () => "attempt",
				requestHeartbeat: async () => true,
				hasHeartbeatContent: () => false,
				now: () => 1000,
				setTimeoutFn: noop,
			});

			scheduler.start();
			expect(scheduler.nextHeartbeatAt).toBeUndefined();
		});

		test("resumes showing nextHeartbeatAt when heartbeat file reappears", async () => {
			let hasContent = false;
			const scheduler = new HeartbeatScheduler({
				config: { intervalMinutes: 30, deferMinutes: 0 },
				promptHomeDir: "/tmp/home",
				shouldAttemptHeartbeat: () => "attempt",
				requestHeartbeat: async () => true,
				hasHeartbeatContent: () => hasContent,
				now: () => 1000,
				setTimeoutFn: noop,
			});

			scheduler.start();
			expect(scheduler.nextHeartbeatAt).toBeUndefined();

			hasContent = true;
			await scheduler.tick();
			expect(scheduler.nextHeartbeatAt).toBe(1000 + 30 * 60_000);
		});
	});

	test("skip advances nextHeartbeatAt to the next poll", async () => {
		let currentTime = 1000;
		const scheduler = new HeartbeatScheduler({
			config: { intervalMinutes: 30, deferMinutes: 0 },
			promptHomeDir: "/tmp/home",
			shouldAttemptHeartbeat: () => "skip",
			requestHeartbeat: async () => true,
			now: () => currentTime,
			setTimeoutFn: noop,
		});

		scheduler.start();
		expect(scheduler.nextHeartbeatAt).toBe(1000 + 30 * 60_000);

		currentTime = 1000 + 30 * 60_000;
		await scheduler.tick();

		expect(scheduler.nextHeartbeatAt).toBe(currentTime + 30 * 60_000);
	});

	test("schedules a timeout and clears it on stop", () => {
		let timeoutHandler: (() => void) | undefined;
		let scheduledMs: number | undefined;
		let cleared = false;
		const timeoutToken = {} as ReturnType<typeof setTimeout>;
		const requestHeartbeat = mock(
			async (_prompt: string, _scheduledAt: number, _deferMinutes: number) =>
				true,
		);

		const scheduler = new HeartbeatScheduler({
			config: { intervalMinutes: 30, deferMinutes: 0 },
			promptHomeDir: "/tmp/home",
			shouldAttemptHeartbeat: () => "attempt",
			requestHeartbeat,
			now: () => 789,
			setTimeoutFn: (handler: () => void, timeout: number) => {
				timeoutHandler = handler;
				scheduledMs = timeout;
				return timeoutToken;
			},
			clearTimeoutFn: (id) => {
				cleared = id === timeoutToken;
			},
		});

		scheduler.start();
		expect(requestHeartbeat).not.toHaveBeenCalled();
		expect(scheduledMs).toBe(30 * 60_000);
		timeoutHandler?.();
		scheduler.stop();

		expect(requestHeartbeat).toHaveBeenCalledWith(
			createHeartbeatPrompt("/tmp/home"),
			789,
			0,
		);
		expect(cleared).toBe(true);
	});
});
