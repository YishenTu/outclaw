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
	mkdirSync(OUTCLAW_DIR, { recursive: true });
	writeFileSync(PID_PATH, String(pid));
}

describe("CLI", () => {
	afterEach(() => {
		if (existsSync(PID_PATH)) {
			const pid = Number.parseInt(readFileSync(PID_PATH, "utf-8"), 10);
			if (Number.isFinite(pid) && pid !== process.pid) {
				runCli("stop");
			}
		}
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

	test("agent create/list/rename/remove manages selectors on disk", () => {
		const created = runCli(
			"agent",
			"create",
			"railly",
			"--bot-token",
			"token-a",
			"--users",
			"2,1",
		);
		expect(created.exitCode).toBe(0);
		expect(created.stdout).toContain("Created agent railly");
		expect(existsSync(join(OUTCLAW_DIR, "agents", "railly", ".agent-id"))).toBe(
			true,
		);

		const listed = runCli("agent", "list");
		expect(listed.exitCode).toBe(0);
		expect(listed.stdout).toContain("railly");

		const renamed = runCli("agent", "rename", "railly", "mimi");
		expect(renamed.exitCode).toBe(0);
		expect(renamed.stdout).toContain("Renamed agent railly -> mimi");
		expect(existsSync(join(OUTCLAW_DIR, "agents", "mimi", ".agent-id"))).toBe(
			true,
		);
		expect(existsSync(join(OUTCLAW_DIR, "agents", "railly"))).toBe(false);

		const removed = runCli("agent", "remove", "mimi");
		expect(removed.exitCode).toBe(0);
		expect(removed.stdout).toContain("Removed agent mimi");
		expect(existsSync(join(OUTCLAW_DIR, "agents", "mimi"))).toBe(false);
	});

	test("agent selector shortcut behaves like tui when daemon is not running", () => {
		const { stdout, exitCode } = runCli("agent", "railly");
		expect(stdout).toContain("not running");
		expect(exitCode).toBe(1);
	});

	test("config secure extracts hardcoded agent telegram config into .env", () => {
		mkdirSync(join(OUTCLAW_DIR, "agents", "railly"), { recursive: true });
		mkdirSync(join(OUTCLAW_DIR, "agents", "mimi"), { recursive: true });
		writeFileSync(
			join(OUTCLAW_DIR, "agents", "railly", ".agent-id"),
			"agent-railly\n",
		);
		writeFileSync(
			join(OUTCLAW_DIR, "agents", "mimi", ".agent-id"),
			"agent-mimi\n",
		);
		writeFileSync(
			join(OUTCLAW_DIR, "config.json"),
			JSON.stringify(
				{
					autoCompact: false,
					heartbeat: { intervalMinutes: 60, deferMinutes: 2 },
					port: 4100,
					agents: {
						"agent-railly": {
							telegram: {
								botToken: "token-a",
								allowedUsers: [101, 202],
							},
						},
						"agent-mimi": {
							telegram: {
								botToken: "$MIMI_TELEGRAM_BOT_TOKEN",
								allowedUsers: "$MIMI_TELEGRAM_USERS",
							},
						},
					},
				},
				null,
				"\t",
			),
		);
		writeFileSync(
			join(OUTCLAW_DIR, ".env"),
			"MIMI_TELEGRAM_BOT_TOKEN=token-b\n",
		);

		const result = runCli("config", "secure");
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("config.json");
		expect(result.stdout).toContain("RAILLY_TELEGRAM_BOT_TOKEN");
		expect(result.stdout).toContain("RAILLY_TELEGRAM_USERS");

		expect(
			JSON.parse(readFileSync(join(OUTCLAW_DIR, "config.json"), "utf-8")),
		).toEqual({
			autoCompact: false,
			heartbeat: { intervalMinutes: 60, deferMinutes: 2 },
			port: 4100,
			agents: {
				"agent-railly": {
					telegram: {
						botToken: "$RAILLY_TELEGRAM_BOT_TOKEN",
						allowedUsers: "$RAILLY_TELEGRAM_USERS",
					},
				},
				"agent-mimi": {
					telegram: {
						botToken: "$MIMI_TELEGRAM_BOT_TOKEN",
						allowedUsers: "$MIMI_TELEGRAM_USERS",
					},
				},
			},
		});
		expect(readFileSync(join(OUTCLAW_DIR, ".env"), "utf-8")).toContain(
			"RAILLY_TELEGRAM_BOT_TOKEN=token-a",
		);
		expect(readFileSync(join(OUTCLAW_DIR, ".env"), "utf-8")).toContain(
			"RAILLY_TELEGRAM_USERS=101,202",
		);
		expect(readFileSync(join(OUTCLAW_DIR, ".env"), "utf-8")).toContain(
			"MIMI_TELEGRAM_BOT_TOKEN=token-b",
		);
	});
});
