import { describe, expect, test } from "bun:test";
import { stopDaemon } from "../../../src/runtime/process/daemon-stop.ts";

describe("stopDaemon", () => {
	test("keeps the PID file when the daemon does not exit before the timeout", async () => {
		let removed = false;
		const result = await stopDaemon(
			{
				read: () => 123,
				remove: () => {
					removed = true;
				},
				isRunning: () => true,
			},
			{
				kill: () => undefined,
				waitForExit: async () => false,
			},
		);

		expect(result).toEqual({ status: "timeout", pid: 123 });
		expect(removed).toBe(false);
	});

	test("removes the PID file after the daemon exits cleanly", async () => {
		let removed = false;
		const result = await stopDaemon(
			{
				read: () => 456,
				remove: () => {
					removed = true;
				},
				isRunning: () => true,
			},
			{
				kill: () => undefined,
				waitForExit: async () => true,
			},
		);

		expect(result).toEqual({ status: "stopped", pid: 456 });
		expect(removed).toBe(true);
	});
});
