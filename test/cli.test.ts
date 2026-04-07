import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TEST_HOME = join(import.meta.dir, ".tmp-cli-test");
const MISANTHROPIC_DIR = join(TEST_HOME, ".misanthropic");
const PID_PATH = join(MISANTHROPIC_DIR, "daemon.pid");
const CLI_PATH = join(import.meta.dir, "../src/cli.ts");

function runCli(...args: string[]) {
	const result = Bun.spawnSync(["bun", CLI_PATH, ...args], {
		env: { ...process.env, HOME: TEST_HOME },
	});
	return {
		stdout: result.stdout.toString().trim(),
		stderr: result.stderr.toString().trim(),
		exitCode: result.exitCode,
	};
}

function writePid(pid: number) {
	mkdirSync(MISANTHROPIC_DIR, { recursive: true });
	writeFileSync(PID_PATH, String(pid));
}

describe("CLI", () => {
	afterEach(() => {
		if (existsSync(TEST_HOME)) {
			rmSync(TEST_HOME, { recursive: true });
		}
	});

	test("no args prints usage", () => {
		const { stdout, exitCode } = runCli();
		expect(stdout).toContain("Usage:");
		expect(exitCode).toBe(1);
	});

	test("status when no daemon shows not running", () => {
		const { stdout } = runCli("status");
		expect(stdout).toContain("not running");
	});

	test("status with stale PID cleans up and shows not running", () => {
		writePid(999999);
		expect(existsSync(PID_PATH)).toBe(true);

		const { stdout } = runCli("status");
		expect(stdout).toContain("not running");
		expect(existsSync(PID_PATH)).toBe(false);
	});

	test("stop when no daemon shows not running", () => {
		const { stdout } = runCli("stop");
		expect(stdout).toContain("not running");
	});

	test("stop with stale PID cleans up and shows not running", () => {
		writePid(999999);
		expect(existsSync(PID_PATH)).toBe(true);

		const { stdout } = runCli("stop");
		expect(stdout).toContain("not running");
		expect(existsSync(PID_PATH)).toBe(false);
	});

	test("start when already running exits with error", () => {
		// Write current process PID to simulate a running daemon
		writePid(process.pid);

		const { stdout, exitCode } = runCli("start");
		expect(stdout).toContain("already running");
		expect(exitCode).toBe(1);
	});

	test("tui when no daemon shows not running", () => {
		const { stdout, exitCode } = runCli("tui");
		expect(stdout).toContain("not running");
		expect(exitCode).toBe(1);
	});
});
