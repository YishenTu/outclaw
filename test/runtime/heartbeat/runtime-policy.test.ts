import { describe, expect, mock, test } from "bun:test";
import { HeartbeatRuntimePolicy } from "../../../src/runtime/heartbeat/runtime-policy.ts";

describe("HeartbeatRuntimePolicy", () => {
	test("decides skip, attempt, and defer from session, pending, and silence state", () => {
		let now = 0;
		const policy = new HeartbeatRuntimePolicy({ now: () => now });

		expect(policy.shouldAttempt(false, 60_000, 1)).toBe("skip");
		expect(policy.shouldAttempt(true, 0, 0)).toBe("attempt");
		expect(policy.shouldAttempt(true, 30_000, 1)).toBe("defer");
		expect(policy.shouldAttempt(true, 60_000, 1)).toBe("attempt");

		policy.markHeartbeatQueued();
		expect(policy.shouldAttempt(true, 60_000, 1)).toBe("skip");

		policy.queueRejected();
		expect(policy.shouldAttempt(true, 60_000, 1)).toBe("attempt");

		now = 10_000;
		policy.noteUserActivity();
		expect(policy.shouldAttempt(true, 60_000, 1)).toBe("defer");
		expect(policy.shouldAttempt(true, 70_000, 1)).toBe("attempt");
	});

	test("deferral timer waits only for the remaining silence window", () => {
		let now = 0;
		const deferred = mock(() => {});
		const scheduled: Array<{
			handler: () => void;
			token: { id: number };
			timeout: number;
		}> = [];
		const cleared: Array<{ id: number }> = [];
		const policy = new HeartbeatRuntimePolicy({
			now: () => now,
			setTimeoutFn: (handler, timeout) => {
				const token = { id: scheduled.length + 1 };
				scheduled.push({ handler, timeout, token });
				return token;
			},
			clearTimeoutFn: (timer) => {
				cleared.push(timer as { id: number });
			},
		});

		policy.setFireDeferredHeartbeat(deferred);
		now = 30_000;
		policy.startDeferTimer(1);

		expect(scheduled.map((entry) => entry.timeout)).toEqual([30_000]);

		now = 45_000;
		policy.noteUserActivity();
		expect(cleared).toEqual([{ id: 1 }]);
		expect(scheduled.map((entry) => entry.timeout)).toEqual([30_000, 60_000]);

		scheduled.at(-1)?.handler();
		expect(deferred).toHaveBeenCalledTimes(1);
	});

	test("shutdown clears pending heartbeat and deferral timer state", () => {
		const cleared: unknown[] = [];
		const policy = new HeartbeatRuntimePolicy({
			now: () => 0,
			setTimeoutFn: () => "timer",
			clearTimeoutFn: (timer) => {
				cleared.push(timer);
			},
		});

		policy.markHeartbeatQueued();
		policy.startDeferTimer(1);
		expect(policy.shouldAttempt(true, 60_000, 0)).toBe("skip");

		policy.beginShutdown();

		expect(cleared).toEqual(["timer"]);
		expect(policy.shouldAttempt(true, 60_000, 0)).toBe("attempt");
	});
});
