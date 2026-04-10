import { describe, expect, test } from "bun:test";
import {
	formatHeartbeatCountdown,
	getHeartbeatCountdownLabel,
} from "../../../../src/frontend/tui/chrome/heartbeat-countdown.ts";

describe("heartbeat countdown", () => {
	test("keeps sub-hour countdowns in minutes when rounding up", () => {
		expect(formatHeartbeatCountdown(59 * 60_000 + 59_000)).toBe("60m");
	});

	test("does not round almost-two-hours up to the next hour", () => {
		expect(formatHeartbeatCountdown(119 * 60_000 + 59_000)).toBe("1h59m");
	});

	test("builds a heartbeat label from the next scheduled time", () => {
		expect(getHeartbeatCountdownLabel(30 * 60_000, 0, false)).toBe("♥ 30m");
		expect(getHeartbeatCountdownLabel(undefined, 0, false)).toBeUndefined();
	});

	test("shows defer label when heartbeat is deferred", () => {
		expect(getHeartbeatCountdownLabel(30 * 60_000, 0, true)).toBe("♥ defer");
	});

	test("returns undefined when deferred but no heartbeat scheduled", () => {
		expect(getHeartbeatCountdownLabel(undefined, 0, true)).toBeUndefined();
	});
});
