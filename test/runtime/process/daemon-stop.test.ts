import { describe, expect, test } from "bun:test";
import {
	stopDaemon,
	waitForProcessExit,
} from "../../../src/runtime/process/daemon-stop.ts";

describe("waitForProcessExit", () => {
	test("returns true once the process disappears during polling", async () => {
		let now = 0;
		let probes = 0;
		const sleeps: number[] = [];

		const exited = await waitForProcessExit(123, {
			kill: (_pid, signal) => {
				expect(signal).toBe(0);
				probes += 1;
				if (probes === 3) {
					const error = new Error("missing process") as NodeJS.ErrnoException;
					error.code = "ESRCH";
					throw error;
				}
			},
			now: () => now,
			pollIntervalMs: 50,
			sleep: async (ms) => {
				sleeps.push(ms);
				now += ms;
			},
			timeoutMs: 200,
		});

		expect(exited).toBe(true);
		expect(probes).toBe(3);
		expect(sleeps).toEqual([50, 50]);
	});

	test("throws unexpected probe errors", async () => {
		await expect(
			waitForProcessExit(123, {
				kill: () => {
					const error = new Error("permission denied") as NodeJS.ErrnoException;
					error.code = "EPERM";
					throw error;
				},
			}),
		).rejects.toThrow("permission denied");
	});

	test("returns false when the timeout expires", async () => {
		let now = 0;

		const exited = await waitForProcessExit(123, {
			kill: () => undefined,
			now: () => now,
			pollIntervalMs: 25,
			sleep: async (ms) => {
				now += ms;
			},
			timeoutMs: 50,
		});

		expect(exited).toBe(false);
	});
});

describe("stopDaemon", () => {
	test("removes stale pid files when the daemon is not running", async () => {
		let removed = false;
		let killed = false;

		const result = await stopDaemon(
			{
				read: () => 123,
				remove: () => {
					removed = true;
				},
				isRunning: () => false,
			},
			{
				kill: () => {
					killed = true;
				},
			},
		);

		expect(result).toEqual({ status: "not_running", pid: 123 });
		expect(removed).toBe(true);
		expect(killed).toBe(false);
	});

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
		const signals: Array<[number, NodeJS.Signals | 0]> = [];
		const result = await stopDaemon(
			{
				read: () => 456,
				remove: () => {
					removed = true;
				},
				isRunning: () => true,
			},
			{
				kill: (pid, signal) => {
					signals.push([pid, signal]);
				},
				waitForExit: async () => true,
			},
		);

		expect(result).toEqual({ status: "stopped", pid: 456 });
		expect(removed).toBe(true);
		expect(signals).toEqual([[456, "SIGTERM"]]);
	});
});
