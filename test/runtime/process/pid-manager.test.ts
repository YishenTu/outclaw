import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PidManager } from "../../../src/runtime/process/pid-manager.ts";

const TEST_DIR = join(import.meta.dir, ".tmp-pid-test");
const PID_PATH = join(TEST_DIR, "daemon.pid");

describe("PidManager", () => {
	afterEach(() => {
		if (existsSync(TEST_DIR)) {
			rmSync(TEST_DIR, { recursive: true });
		}
	});

	test("write and read PID", () => {
		mkdirSync(TEST_DIR, { recursive: true });
		const pid = new PidManager(PID_PATH);

		pid.write(12345);
		expect(pid.read()).toBe(12345);
	});

	test("read returns undefined when no PID file", () => {
		const pid = new PidManager(PID_PATH);
		expect(pid.read()).toBeUndefined();
	});

	test("remove deletes PID file", () => {
		mkdirSync(TEST_DIR, { recursive: true });
		const pid = new PidManager(PID_PATH);

		pid.write(12345);
		pid.remove();
		expect(pid.read()).toBeUndefined();
		expect(existsSync(PID_PATH)).toBe(false);
	});

	test("isRunning returns true for current process", () => {
		mkdirSync(TEST_DIR, { recursive: true });
		const pid = new PidManager(PID_PATH);

		pid.write(process.pid);
		expect(pid.isRunning()).toBe(true);
	});

	test("isRunning returns false for dead PID", () => {
		mkdirSync(TEST_DIR, { recursive: true });
		const pid = new PidManager(PID_PATH);

		pid.write(999999);
		expect(pid.isRunning()).toBe(false);
	});

	test("isRunning returns false when no PID file", () => {
		const pid = new PidManager(PID_PATH);
		expect(pid.isRunning()).toBe(false);
	});
});
