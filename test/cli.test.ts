import { afterEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

const TEST_HOME = join(import.meta.dir, ".tmp-cli-test");
const OUTCLAW_DIR = join(TEST_HOME, ".outclaw");
const PID_PATH = join(OUTCLAW_DIR, "daemon.pid");
const CLI_PATH = join(import.meta.dir, "../src/cli.ts");

function runCli(args: string[], options?: { cwd?: string }) {
	const result = Bun.spawnSync(["bun", CLI_PATH, ...args], {
		cwd: options?.cwd,
		env: { ...process.env, HOME: TEST_HOME, TZ: "UTC" },
	});
	return {
		stdout: result.stdout.toString().trim(),
		stderr: result.stderr.toString().trim(),
		exitCode: result.exitCode,
	};
}

function writePid(pid: number) {
	mkdirSync(OUTCLAW_DIR, { recursive: true });
	writeFileSync(PID_PATH, String(pid));
}

describe("CLI", () => {
	afterEach(() => {
		if (existsSync(PID_PATH)) {
			const pid = Number.parseInt(readFileSync(PID_PATH, "utf-8"), 10);
			if (Number.isFinite(pid) && pid !== process.pid) {
				runCli(["stop"]);
			}
		}
		if (existsSync(TEST_HOME)) {
			rmSync(TEST_HOME, { recursive: true });
		}
	});

	test("no args prints operator-only usage", () => {
		const { stdout, exitCode } = runCli([]);

		expect(stdout).toContain(
			"Usage: oc <start|stop|restart|status|tui|browser|onboard|dev|build>",
		);
		expect(stdout).toContain("first run:   oc build && oc start");
		expect(stdout).toContain("command help: oc <command> -h");
		expect(stdout).not.toContain("oc agent");
		expect(stdout).not.toContain("oc coding");
		expect(stdout).not.toContain("oc session");
		expect(stdout).not.toContain("oc cron");
		expect(stdout).not.toContain("oc note");
		expect(stdout).not.toContain("oc schema");
		expect(exitCode).toBe(1);
	});

	test("dash h prints usage hints and exits successfully", () => {
		const { stdout, exitCode } = runCli(["-h"]);

		expect(stdout).toContain(
			"Usage: oc <start|stop|restart|status|tui|browser|onboard|dev|build>",
		);
		expect(stdout).toContain("oc onboard");
		expect(stdout).not.toContain("oc config");
		expect(exitCode).toBe(0);
	});

	test("start dash h prints start-specific help and exits successfully", () => {
		const { stdout, exitCode } = runCli(["start", "-h"]);

		expect(stdout).toContain("Usage: oc start [--lan] [--host HOST]");
		expect(stdout).toContain("0.0.0.0");
		expect(stdout).toContain("127.0.0.1");
		expect(stdout).toContain("oc build && oc restart");
		expect(exitCode).toBe(0);
	});

	test("restart dash h prints start-specific help and exits successfully", () => {
		const { stdout, exitCode } = runCli(["restart", "-h"]);

		expect(stdout).toContain("Usage: oc start [--lan] [--host HOST]");
		expect(stdout).toContain("oc restart [--lan] [--host HOST]");
		expect(exitCode).toBe(0);
	});

	test("onboard dash h prints onboarding help and exits successfully", () => {
		const { stdout, exitCode } = runCli(["onboard", "-h"]);

		expect(stdout).toContain("Usage: oc onboard");
		expect(stdout).toContain("Launch the interactive agent onboarding TUI.");
		expect(exitCode).toBe(0);
	});

	test("status when no daemon shows not running", () => {
		const { stdout, exitCode } = runCli(["status"]);

		expect(stdout).toContain("not running");
		expect(exitCode).toBe(0);
	});

	test("status with stale PID cleans up and shows not running", () => {
		writePid(999999);
		expect(existsSync(PID_PATH)).toBe(true);

		const { stdout, exitCode } = runCli(["status"]);

		expect(stdout).toContain("not running");
		expect(existsSync(PID_PATH)).toBe(false);
		expect(exitCode).toBe(0);
	});

	test("stop when no daemon shows not running", () => {
		const { stdout, exitCode } = runCli(["stop"]);

		expect(stdout).toContain("not running");
		expect(exitCode).toBe(0);
	});

	test("start when already running exits with error", () => {
		writePid(process.pid);

		const { stdout, exitCode } = runCli(["start"]);

		expect(stdout).toContain("Daemon already running");
		expect(exitCode).toBe(1);
	});

	test("removed workflow commands print operator-only usage", () => {
		for (const command of [
			"agent",
			"config",
			"coding",
			"session",
			"cron",
			"note",
			"schema",
		]) {
			const { stdout, stderr, exitCode } = runCli([command, "-h"]);

			expect(stdout).toContain(
				"Usage: oc <start|stop|restart|status|tui|browser|onboard|dev|build>",
			);
			expect(stdout).not.toContain(`oc ${command}`);
			expect(stderr).toBe("");
			expect(exitCode).toBe(1);
		}
	});
});
