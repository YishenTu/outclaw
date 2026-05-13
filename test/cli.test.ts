import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { parseAskArgs } from "../src/cli/commands/agent-ask.ts";
import type { FrontendNotice } from "../src/common/protocol.ts";
import { SessionStore } from "../src/runtime/persistence/session-store/session-store.ts";
import { createTestServer } from "./helpers/test-server.ts";

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

async function runCliAsync(args: string[], options?: { cwd?: string }) {
	const child = Bun.spawn(["bun", CLI_PATH, ...args], {
		cwd: options?.cwd,
		env: { ...process.env, HOME: TEST_HOME, TZ: "UTC" },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return {
		stdout: stdout.trim(),
		stderr: stderr.trim(),
		exitCode,
	};
}

async function runCliAsyncWithTimeout(
	args: string[],
	options: { cwd?: string; timeoutMs: number },
) {
	const child = Bun.spawn(["bun", CLI_PATH, ...args], {
		cwd: options.cwd,
		env: { ...process.env, HOME: TEST_HOME, TZ: "UTC" },
		stdout: "pipe",
		stderr: "pipe",
	});
	let timedOut = false;
	const timeout = setTimeout(() => {
		timedOut = true;
		child.kill();
	}, options.timeoutMs);
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	clearTimeout(timeout);
	return {
		stdout: stdout.trim(),
		stderr: stderr.trim(),
		exitCode,
		timedOut,
	};
}

function createAgentHome(name: string, agentId: string) {
	const agentHome = join(OUTCLAW_DIR, "agents", name);
	mkdirSync(agentHome, { recursive: true });
	writeFileSync(join(agentHome, ".agent-id"), `${agentId}\n`);
	return agentHome;
}

function writeSchema(
	agentHome: string,
	filename: string,
	frontmatter: Record<string, string>,
) {
	const schemasDir = join(agentHome, "schemas");
	mkdirSync(schemasDir, { recursive: true });
	const body = Object.entries(frontmatter)
		.map(([key, value]) => `${key}: ${value}`)
		.join("\n");
	writeFileSync(
		join(schemasDir, filename),
		`---\n${body}\n---\n\n# Model\n\n---\n\n# Observations\n`,
	);
}

function seedSession(params: {
	agentId: string;
	providerId: string;
	sdkSessionId: string;
	title: string;
	tag?: "chat" | "cron";
	createdAt: number;
	lastActive: number;
	failedAt?: number;
	failureMessage?: string;
}) {
	const dbPath = join(OUTCLAW_DIR, "db.sqlite");
	const store = new SessionStore(dbPath, { agentId: params.agentId });
	store.upsert({
		providerId: params.providerId,
		sdkSessionId: params.sdkSessionId,
		title: params.title,
		model: "opus",
		tag: params.tag,
		failure:
			params.failedAt === undefined || params.failureMessage === undefined
				? undefined
				: {
						failedAt: params.failedAt,
						message: params.failureMessage,
					},
	});
	store.close();

	const db = new Database(dbPath);
	db.query(
		`UPDATE sessions
		 SET created_at = $createdAt,
		     last_active = $lastActive
		 WHERE agent_id = $agentId
		   AND provider_id = $providerId
		   AND sdk_session_id = $id`,
	).run({
		$createdAt: params.createdAt,
		$lastActive: params.lastActive,
		$agentId: params.agentId,
		$providerId: params.providerId,
		$id: params.sdkSessionId,
	});
	db.close();
}

function writePid(pid: number) {
	mkdirSync(OUTCLAW_DIR, { recursive: true });
	writeFileSync(PID_PATH, String(pid));
}

function readPid() {
	return Number.parseInt(readFileSync(PID_PATH, "utf-8"), 10);
}

function writeConfig(port: number) {
	mkdirSync(OUTCLAW_DIR, { recursive: true });
	writeFileSync(
		join(OUTCLAW_DIR, "config.json"),
		JSON.stringify(
			{
				autoCompact: true,
				heartbeat: { intervalMinutes: 30, deferMinutes: 0 },
				host: "127.0.0.1",
				port,
				thinkingEffort: "medium",
			},
			null,
			"\t",
		),
	);
}

function readConfigDocument() {
	return JSON.parse(readFileSync(join(OUTCLAW_DIR, "config.json"), "utf-8"));
}

function readFrontendNotice() {
	const store = new SessionStore(join(OUTCLAW_DIR, "db.sqlite"));
	try {
		return store.getFrontendNotice();
	} finally {
		store.close();
	}
}

async function waitForFrontendNotice(
	timeoutMs = 2000,
): Promise<FrontendNotice | undefined> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const notice = readFrontendNotice();
		if (notice?.kind === "restart_required") {
			return notice;
		}
		await new Promise<void>((resolve) => setTimeout(resolve, 25));
	}
	return readFrontendNotice();
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

	test("no args prints usage", () => {
		const { stdout, exitCode } = runCli([]);
		expect(stdout).toContain("Usage:");
		expect(stdout).toContain(
			"<start|stop|restart|status|tui|browser|onboard|dev",
		);
		expect(stdout).toContain("|agent|config|coding|session|cron|");
		expect(stdout).toContain(
			"oc agent <list|create|config|rename|remove|ask|send|name>",
		);
		expect(stdout).toContain('oc coding start <repo-id-or-path> "<prompt>"');
		expect(stdout).toContain("first run:   oc build && oc start");
		expect(stdout).toContain("command help: oc <command> -h");
		expect(stdout).not.toContain("LAN browser: oc start --lan");
		expect(stdout).not.toContain("web update:  oc build && oc restart");
		expect(exitCode).toBe(1);
	});

	test("dash h prints usage hints and exits successfully", () => {
		const { stdout, exitCode } = runCli(["-h"]);
		expect(stdout).toContain("Usage:");
		expect(stdout).toContain("first run:   oc build && oc start");
		expect(stdout).toContain("oc onboard");
		expect(stdout).toContain("command help: oc <command> -h");
		expect(stdout).not.toContain("LAN browser: oc start --lan");
		expect(stdout).not.toContain("web update:  oc build && oc restart");
		expect(exitCode).toBe(0);
	});

	test("onboard dash h prints onboarding help and exits successfully", () => {
		const { stdout, exitCode } = runCli(["onboard", "-h"]);
		expect(stdout).toContain("Usage: oc onboard");
		expect(stdout).toContain("Launch the interactive agent onboarding TUI.");
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

	test("agent dash h prints agent-specific help and exits successfully", () => {
		const { stdout, exitCode } = runCli(["agent", "-h"]);
		expect(stdout).toContain(
			"Usage: oc agent <list|create|config|rename|remove|ask|send|name>",
		);
		expect(stdout).toContain("create");
		expect(stdout).toContain("config");
		expect(stdout).toContain("ask");
		expect(stdout).toContain("send");
		expect(stdout).toContain("open TUI attached to that agent");
		expect(exitCode).toBe(0);
	});

	test("agent create dash h prints create help without creating an agent", () => {
		const { stdout, exitCode } = runCli(["agent", "create", "-h"]);
		expect(stdout).toContain(
			"Usage: oc agent create <name> [--bot-token <token>] [--users <ids>] [--default-cron-user <id>]",
		);
		expect(existsSync(join(OUTCLAW_DIR, "agents", "-h"))).toBe(false);
		expect(exitCode).toBe(0);
	});

	test("config dash h prints config-specific help and exits successfully", () => {
		const { stdout, exitCode } = runCli(["config", "-h"]);
		expect(stdout).toContain("Usage: oc config <runtime|secure>");
		expect(stdout).toContain("oc config runtime");
		expect(stdout).toContain("oc config secure");
		expect(exitCode).toBe(0);
	});

	test("config runtime dash h prints runtime help and exits successfully", () => {
		const { stdout, exitCode } = runCli(["config", "runtime", "-h"]);
		expect(stdout).toContain(
			"Usage: oc config runtime [--host HOST] [--port N] [--auto-compact true|false] [--heartbeat-interval N] [--heartbeat-defer N] [--thinking-effort LEVEL]",
		);
		expect(stdout).toContain("config.json");
		expect(exitCode).toBe(0);
	});

	test("session dash h prints session-specific help and exits successfully", () => {
		const { stdout, exitCode } = runCli(["session", "-h"]);
		expect(stdout).toContain("Usage: oc session <list|search|transcript>");
		expect(stdout).toContain("oc session list");
		expect(stdout).toContain("oc session search");
		expect(stdout).toContain("oc session transcript");
		expect(exitCode).toBe(0);
	});

	test("cron dash h prints cron-specific help and exits successfully", () => {
		const { stdout, exitCode } = runCli(["cron", "-h"]);
		expect(stdout).toContain("Usage: oc cron <run|status>");
		expect(stdout).toContain("oc cron run <cron-name>");
		expect(stdout).toContain("oc cron status --failed");
		expect(exitCode).toBe(0);
	});

	test("cron run dash h prints run help and exits successfully", () => {
		const { stdout, exitCode } = runCli(["cron", "run", "-h"]);
		expect(stdout).toContain("Usage: oc cron run <cron-name>");
		expect(stdout).toContain("Triggers a cron job in the running daemon.");
		expect(exitCode).toBe(0);
	});

	test("cron status dash h prints status help and exits successfully", () => {
		const { stdout, exitCode } = runCli(["cron", "status", "-h"]);
		expect(stdout).toContain("Usage: oc cron status --failed");
		expect(stdout).toContain("--since");
		expect(exitCode).toBe(0);
	});

	test("schema dash h prints schema-specific help and exits successfully", () => {
		const { stdout, exitCode } = runCli(["schema", "-h"]);
		expect(stdout).toContain("Usage: oc schema <status|stale>");
		expect(stdout).toContain("oc schema status [--agent <name|id>] [--json]");
		expect(exitCode).toBe(0);
	});

	test("session list dash h prints list help and exits successfully", () => {
		const { stdout, exitCode } = runCli(["session", "list", "-h"]);
		expect(stdout).toContain("Usage: oc session list [--limit N] [--tag cron]");
		expect(stdout).toContain("Default tag: chat");
		expect(exitCode).toBe(0);
	});

	test("session search dash h prints search help and exits successfully", () => {
		const { stdout, exitCode } = runCli(["session", "search", "-h"]);
		expect(stdout).toContain("Usage: oc session search <query> [--limit N]");
		expect(stdout).toContain("Searches chat sessions");
		expect(exitCode).toBe(0);
	});

	test("session transcript dash h prints transcript help and exits successfully", () => {
		const { stdout, exitCode } = runCli(["session", "transcript", "-h"]);
		expect(stdout).toContain(
			"Usage: oc session transcript <id-or-prefix> [--limit N] [--tag cron]",
		);
		expect(stdout).toContain("Use a session id or unique prefix");
		expect(exitCode).toBe(0);
	});

	test("status when no daemon shows not running", () => {
		const { stdout } = runCli(["status"]);
		expect(stdout).toContain("not running");
	});

	test("status with stale PID cleans up and shows not running", () => {
		writePid(999999);
		expect(existsSync(PID_PATH)).toBe(true);

		const { stdout } = runCli(["status"]);
		expect(stdout).toContain("not running");
		expect(existsSync(PID_PATH)).toBe(false);
	});

	test("stop when no daemon shows not running", () => {
		const { stdout } = runCli(["stop"]);
		expect(stdout).toContain("not running");
	});

	test("stop with stale PID cleans up and shows not running", () => {
		writePid(999999);
		expect(existsSync(PID_PATH)).toBe(true);

		const { stdout } = runCli(["stop"]);
		expect(stdout).toContain("not running");
		expect(existsSync(PID_PATH)).toBe(false);
	});

	test("start when already running exits with error", () => {
		// Write current process PID to simulate a running daemon
		writePid(process.pid);

		const { stdout, exitCode } = runCli(["start"]);
		expect(stdout).toContain("already running");
		expect(exitCode).toBe(1);
	});

	test("start reseeds missing prompt templates for existing agents", () => {
		runCli(["agent", "create", "railly"]);
		const agentHome = join(OUTCLAW_DIR, "agents", "railly");
		const missingPaths = [
			"AGENTS.md",
			join("cron", "memory-distill.yaml"),
			join("skills", "oc", "references", "agent-com.md"),
		];
		for (const relativePath of missingPaths) {
			rmSync(join(agentHome, relativePath));
		}
		writeConfig(0);

		const result = runCli(["start"]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Daemon started");
		expect(existsSync(join(agentHome, "AGENTS.md"))).toBe(true);
		expect(readFileSync(join(agentHome, "AGENTS.md"), "utf-8")).toContain(
			"# AGENTS.md",
		);
		expect(
			readFileSync(join(agentHome, "cron", "memory-distill.yaml"), "utf-8"),
		).toContain("name:");
		expect(
			readFileSync(
				join(agentHome, "skills", "oc", "references", "agent-com.md"),
				"utf-8",
			),
		).toContain("# Agent Communication");
	});

	test("start keeps the daemon running after the start command exits", () => {
		runCli(["agent", "create", "railly"]);
		writeConfig(0);

		const start = runCli(["start"]);
		expect(start.exitCode).toBe(0);
		expect(start.stdout).toContain("Daemon started");

		const status = runCli(["status"]);
		expect(status.exitCode).toBe(0);
		expect(status.stdout).toContain("Daemon running");
	});

	test.serial("start --lan saves the runtime host for LAN access", async () => {
		runCli(["agent", "create", "railly"]);
		writeConfig(0);

		const result = await runCliAsync(["start", "--lan"]);

		expect(result.exitCode).toBe(0);
		expect(readConfigDocument()).toMatchObject({
			autoCompact: true,
			host: "0.0.0.0",
			heartbeat: { intervalMinutes: 30, deferMinutes: 0 },
			port: 0,
		});
	});

	test.serial(
		"start --host saves an explicit runtime host override",
		async () => {
			runCli(["agent", "create", "railly"]);
			writeConfig(0);

			const result = await runCliAsync(["start", "--host", "127.0.0.1"]);

			expect(result.exitCode).toBe(0);
			expect(readConfigDocument()).toMatchObject({
				autoCompact: true,
				host: "127.0.0.1",
				heartbeat: { intervalMinutes: 30, deferMinutes: 0 },
				port: 0,
			});
		},
	);

	test.serial("start rejects conflicting host flags", () => {
		const result = runCli(["start", "--lan", "--host", "0.0.0.0"]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("Cannot combine multiple host flags");
	});

	test("tui when no daemon shows not running", () => {
		const { stdout, exitCode } = runCli(["tui"]);
		expect(stdout).toContain("not running");
		expect(exitCode).toBe(1);
	});

	test("agent create/list/rename/remove manages selectors on disk", () => {
		const created = runCli([
			"agent",
			"create",
			"railly",
			"--bot-token",
			"token-a",
			"--users",
			"2,1",
		]);
		expect(created.exitCode).toBe(0);
		expect(created.stdout).toContain("Created agent railly");
		expect(existsSync(join(OUTCLAW_DIR, "agents", "railly", ".agent-id"))).toBe(
			true,
		);

		const listed = runCli(["agent", "list"]);
		expect(listed.exitCode).toBe(0);
		expect(listed.stdout).toContain("railly");

		const renamed = runCli(["agent", "rename", "railly", "mimi"]);
		expect(renamed.exitCode).toBe(0);
		expect(renamed.stdout).toContain("Renamed agent railly -> mimi");
		expect(existsSync(join(OUTCLAW_DIR, "agents", "mimi", ".agent-id"))).toBe(
			true,
		);
		expect(existsSync(join(OUTCLAW_DIR, "agents", "railly"))).toBe(false);

		const removed = runCli(["agent", "remove", "mimi"]);
		expect(removed.exitCode).toBe(0);
		expect(removed.stdout).toContain("Removed agent mimi");
		expect(existsSync(join(OUTCLAW_DIR, "agents", "mimi"))).toBe(false);
	});

	test("agent config updates telegram settings on an existing agent", () => {
		runCli([
			"agent",
			"create",
			"railly",
			"--bot-token",
			"token-a",
			"--users",
			"1,2",
		]);

		const result = runCli([
			"agent",
			"config",
			"railly",
			"--bot-token",
			"token-b",
			"--default-cron-user",
			"2",
			"--rollover-idle",
			"90",
		]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Configured agent railly");

		const config = JSON.parse(
			readFileSync(join(OUTCLAW_DIR, "config.json"), "utf-8"),
		);
		const agentId = readFileSync(
			join(OUTCLAW_DIR, "agents", "railly", ".agent-id"),
			"utf-8",
		).trim();
		expect(config.agents[agentId].telegram.botToken).toBe("token-b");
		expect(config.agents[agentId].telegram.allowedUsers).toEqual([1, 2]);
		expect(config.agents[agentId].telegram.defaultCronUserId).toBe(2);
		expect(config.agents[agentId].rollover.idleMinutes).toBe(90);
	});

	test("agent create persists a default cron user when provided", () => {
		const result = runCli([
			"agent",
			"create",
			"railly",
			"--bot-token",
			"token-a",
			"--users",
			"1,2",
			"--default-cron-user",
			"2",
		]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Created agent railly");

		const config = JSON.parse(
			readFileSync(join(OUTCLAW_DIR, "config.json"), "utf-8"),
		);
		const agentId = readFileSync(
			join(OUTCLAW_DIR, "agents", "railly", ".agent-id"),
			"utf-8",
		).trim();
		expect(config.agents[agentId].telegram.defaultCronUserId).toBe(2);
	});

	test("agent create persists rollover idle minutes when provided", () => {
		const result = runCli([
			"agent",
			"create",
			"railly",
			"--rollover-idle",
			"120",
		]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Created agent railly");

		const config = JSON.parse(
			readFileSync(join(OUTCLAW_DIR, "config.json"), "utf-8"),
		);
		const agentId = readFileSync(
			join(OUTCLAW_DIR, "agents", "railly", ".agent-id"),
			"utf-8",
		).trim();
		expect(config.agents[agentId].rollover.idleMinutes).toBe(120);
	});

	test("agent create does not restart the daemon when it is running", async () => {
		runCli(["agent", "create", "railly"]);
		writeConfig(0);
		expect(runCli(["start"]).exitCode).toBe(0);
		const originalPid = readPid();

		const result = runCli(["agent", "create", "mimi"]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Created agent mimi");
		expect(result.stdout).toContain("Restart required");
		expect(readPid()).toBe(originalPid);
		expect(await waitForFrontendNotice()).toEqual({ kind: "restart_required" });
	});

	test("agent rename does not restart the daemon when it is running", async () => {
		runCli(["agent", "create", "railly"]);
		writeConfig(0);
		expect(runCli(["start"]).exitCode).toBe(0);
		const originalPid = readPid();

		const result = runCli(["agent", "rename", "railly", "mimi"]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Renamed agent railly -> mimi");
		expect(result.stdout).toContain("Restart required");
		expect(readPid()).toBe(originalPid);
		expect(await waitForFrontendNotice()).toEqual({ kind: "restart_required" });
	});

	test("agent remove does not restart the daemon when it is running", async () => {
		runCli(["agent", "create", "railly"]);
		runCli(["agent", "create", "mimi"]);
		writeConfig(0);
		expect(runCli(["start"]).exitCode).toBe(0);
		const originalPid = readPid();

		const result = runCli(["agent", "remove", "mimi"]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Removed agent mimi");
		expect(result.stdout).toContain("Restart required");
		expect(readPid()).toBe(originalPid);
		expect(await waitForFrontendNotice()).toEqual({ kind: "restart_required" });
	});

	test("agent remove leaves the daemon running when it removes the last agent", async () => {
		runCli(["agent", "create", "railly"]);
		writeConfig(0);
		expect(runCli(["start"]).exitCode).toBe(0);
		const originalPid = readPid();
		expect(existsSync(PID_PATH)).toBe(true);

		const result = runCli(["agent", "remove", "railly"]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Removed agent railly");
		expect(result.stdout).toContain("Restart required");
		expect(existsSync(PID_PATH)).toBe(true);
		expect(readPid()).toBe(originalPid);
		expect(await waitForFrontendNotice()).toEqual({ kind: "restart_required" });
	});

	test("agent config does not restart the daemon when it is running", async () => {
		runCli([
			"agent",
			"create",
			"railly",
			"--bot-token",
			"token-a",
			"--users",
			"1,2",
		]);
		writeConfig(0);
		expect(runCli(["start"]).exitCode).toBe(0);
		const originalPid = readPid();

		const result = runCli([
			"agent",
			"config",
			"railly",
			"--bot-token",
			"token-b",
		]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Configured agent railly");
		expect(result.stdout).toContain("Restart required");
		expect(readPid()).toBe(originalPid);
		expect(await waitForFrontendNotice()).toEqual({ kind: "restart_required" });
	});

	test("agent create rejects invalid users", () => {
		const result = runCli(["agent", "create", "railly", "--users", "abc"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("Invalid users");
		expect(existsSync(join(OUTCLAW_DIR, "agents", "railly"))).toBe(false);
	});

	test("agent create rejects a default cron user outside allowed users", () => {
		const result = runCli([
			"agent",
			"create",
			"railly",
			"--users",
			"1,2",
			"--default-cron-user",
			"3",
		]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			"Default cron user 3 must be included in allowed users",
		);
		expect(existsSync(join(OUTCLAW_DIR, "agents", "railly"))).toBe(false);
	});

	test("agent config rejects invalid users and preserves existing config", () => {
		runCli([
			"agent",
			"create",
			"railly",
			"--bot-token",
			"token-a",
			"--users",
			"1,2",
		]);

		const result = runCli(["agent", "config", "railly", "--users", "abc"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("Invalid users");

		const config = JSON.parse(
			readFileSync(join(OUTCLAW_DIR, "config.json"), "utf-8"),
		);
		const agentId = readFileSync(
			join(OUTCLAW_DIR, "agents", "railly", ".agent-id"),
			"utf-8",
		).trim();
		expect(config.agents[agentId].telegram.botToken).toBe("token-a");
		expect(config.agents[agentId].telegram.allowedUsers).toEqual([1, 2]);
		expect(config.agents[agentId].telegram.defaultCronUserId).toBeUndefined();
	});

	test("agent config rejects invalid default cron user and preserves existing config", () => {
		runCli([
			"agent",
			"create",
			"railly",
			"--bot-token",
			"token-a",
			"--users",
			"1,2",
		]);

		const result = runCli([
			"agent",
			"config",
			"railly",
			"--default-cron-user",
			"abc",
		]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("Invalid default cron user");

		const config = JSON.parse(
			readFileSync(join(OUTCLAW_DIR, "config.json"), "utf-8"),
		);
		const agentId = readFileSync(
			join(OUTCLAW_DIR, "agents", "railly", ".agent-id"),
			"utf-8",
		).trim();
		expect(config.agents[agentId].telegram.defaultCronUserId).toBeUndefined();
	});

	test("agent config rejects a default cron user outside allowed users", () => {
		runCli([
			"agent",
			"create",
			"railly",
			"--bot-token",
			"token-a",
			"--users",
			"1,2",
		]);

		const result = runCli([
			"agent",
			"config",
			"railly",
			"--default-cron-user",
			"3",
		]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			"Default cron user 3 must be included in allowed users",
		);
	});

	test("agent config preserves env-backed telegram config", () => {
		createAgentHome("railly", "agent-railly");
		writeFileSync(
			join(OUTCLAW_DIR, "config.json"),
			JSON.stringify(
				{
					agents: {
						"agent-railly": {
							telegram: {
								botToken: "$RAILLY_TELEGRAM_BOT_TOKEN",
								allowedUsers: "$RAILLY_TELEGRAM_USERS",
								defaultCronUserId: "$RAILLY_DEFAULT_CRON_USER",
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
			"RAILLY_TELEGRAM_BOT_TOKEN=token-a\nRAILLY_TELEGRAM_USERS=1,2\nRAILLY_DEFAULT_CRON_USER=1\n",
		);

		const result = runCli([
			"agent",
			"config",
			"railly",
			"--bot-token",
			"token-b",
			"--users",
			"3,4",
			"--default-cron-user",
			"3",
		]);
		expect(result.exitCode).toBe(0);

		const config = JSON.parse(
			readFileSync(join(OUTCLAW_DIR, "config.json"), "utf-8"),
		);
		expect(config.agents["agent-railly"].telegram.botToken).toBe(
			"$RAILLY_TELEGRAM_BOT_TOKEN",
		);
		expect(config.agents["agent-railly"].telegram.allowedUsers).toBe(
			"$RAILLY_TELEGRAM_USERS",
		);
		expect(config.agents["agent-railly"].telegram.defaultCronUserId).toBe(
			"$RAILLY_DEFAULT_CRON_USER",
		);
		expect(readFileSync(join(OUTCLAW_DIR, ".env"), "utf-8")).toContain(
			"RAILLY_TELEGRAM_BOT_TOKEN=token-b",
		);
		expect(readFileSync(join(OUTCLAW_DIR, ".env"), "utf-8")).toContain(
			"RAILLY_TELEGRAM_USERS=3,4",
		);
		expect(readFileSync(join(OUTCLAW_DIR, ".env"), "utf-8")).toContain(
			"RAILLY_DEFAULT_CRON_USER=3",
		);
	});

	test("agent selector shortcut behaves like tui when daemon is not running", () => {
		const { stdout, exitCode } = runCli(["agent", "railly"]);
		expect(stdout).toContain("not running");
		expect(exitCode).toBe(1);
	});

	test("schema status resolves the current agent from cwd .agent-id", () => {
		const agentHome = createAgentHome("railly", "agent-railly");
		writeSchema(agentHome, "food-and-drink.md", {
			name: "food-and-drink",
			kind: "topic",
			last_observation_at: "2026-04-26",
			last_synthesized: "2026-04-27",
		});
		writeSchema(agentHome, "working-with-yishen.md", {
			name: "working-with-yishen",
			kind: "topic",
			last_observation_at: "2026-04-26",
			last_synthesized: "2026-04-20",
		});

		const result = runCli(["schema", "status"], { cwd: agentHome });

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe(
			[
				"working-with-yishen  obs:2026-04-26  syn:2026-04-20  STALE",
				"food-and-drink       obs:2026-04-26  syn:2026-04-27  fresh",
			].join("\n"),
		);
		expect(existsSync(join(OUTCLAW_DIR, "config.json"))).toBe(false);
	});

	test("schema stale resolves --agent by name and emits json", () => {
		const agentHome = createAgentHome("railly", "agent-railly");
		writeSchema(agentHome, "fresh.md", {
			name: "fresh",
			kind: "topic",
			last_observation_at: "2026-04-20",
			last_synthesized: "2026-04-21",
		});
		writeSchema(agentHome, "stale.md", {
			name: "stale",
			kind: "topic",
			last_observation_at: "2026-04-26",
			last_synthesized: "2026-04-20",
		});
		writeSchema(agentHome, "broken.md", {
			name: "broken",
			kind: "topic",
			last_observation_at: "2026-04-26",
		});

		const result = runCli(["schema", "stale", "--agent", "railly", "--json"], {
			cwd: TEST_HOME,
		});

		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual([
			{
				name: "stale",
				last_observation_at: "2026-04-26",
				last_synthesized: "2026-04-20",
				state: "STALE",
			},
			{
				name: "broken",
				last_observation_at: "2026-04-26",
				last_synthesized: null,
				state: "BROKEN",
				reason: "missing last_synthesized",
			},
		]);
		expect(existsSync(join(OUTCLAW_DIR, "config.json"))).toBe(false);
	});

	test("agent ask resolves sender from cwd and prints control response", async () => {
		createAgentHome("railly", "agent-railly");
		createAgentHome("mimi", "agent-mimi");
		const server = createTestServer({
			port: 0,
			fetch(req, websocketServer) {
				if (websocketServer.upgrade(req)) {
					return;
				}
				return new Response("ok");
			},
			websocket: {
				message(ws, rawMessage) {
					const message = JSON.parse(String(rawMessage));
					expect(message).toEqual({
						type: "ask",
						fromAgentId: "agent-railly",
						to: "mimi",
						message: "hi there",
					});
					ws.send(JSON.stringify({ type: "ask_response", text: "hello back" }));
				},
			},
		});
		writeConfig(server.port as number);

		try {
			const result = await runCliAsync(
				["agent", "ask", "--to", "mimi", "hi there"],
				{
					cwd: join(OUTCLAW_DIR, "agents", "railly"),
				},
			);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("hello back");
		} finally {
			server.stop();
		}
	});

	test("agent send resolves sender from cwd and prints nothing on acceptance", async () => {
		createAgentHome("railly", "agent-railly");
		createAgentHome("mimi", "agent-mimi");
		const server = createTestServer({
			port: 0,
			fetch(req, websocketServer) {
				if (websocketServer.upgrade(req)) {
					return;
				}
				return new Response("ok");
			},
			websocket: {
				message(ws, rawMessage) {
					const message = JSON.parse(String(rawMessage));
					expect(message).toEqual({
						type: "send",
						fromAgentId: "agent-railly",
						to: "mimi",
						message: "please continue independently",
					});
					ws.send(JSON.stringify({ type: "send_response" }));
				},
			},
		});
		writeConfig(server.port as number);

		try {
			const result = await runCliAsync(
				[
					"agent",
					"send",
					"--to",
					"mimi",
					"please",
					"continue",
					"independently",
				],
				{
					cwd: join(OUTCLAW_DIR, "agents", "railly"),
				},
			);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe("");
		} finally {
			server.stop();
		}
	});

	test("agent ask exits when cwd cannot resolve sender", () => {
		mkdirSync(TEST_HOME, { recursive: true });
		const result = runCli(["agent", "ask", "--to", "mimi", "hi there"], {
			cwd: TEST_HOME,
		});
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("cannot resolve sender agent from cwd");
	});

	test("agent ask does not treat flag values as the message body", async () => {
		createAgentHome("railly", "agent-railly");
		createAgentHome("mimi", "agent-mimi");
		const server = createTestServer({
			port: 0,
			fetch(req, websocketServer) {
				if (websocketServer.upgrade(req)) {
					return;
				}
				return new Response("ok");
			},
			websocket: {
				message(ws, rawMessage) {
					const message = JSON.parse(String(rawMessage));
					expect(message).toEqual({
						type: "ask",
						fromAgentId: "agent-railly",
						to: "mimi",
						message: "hello there",
					});
					ws.send(JSON.stringify({ type: "ask_response", text: "hello back" }));
				},
			},
		});
		writeConfig(server.port as number);

		try {
			const result = await runCliAsync(
				["agent", "ask", "--to", "mimi", "--timeout", "10", "hello", "there"],
				{
					cwd: join(OUTCLAW_DIR, "agents", "railly"),
				},
			);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("hello back");
		} finally {
			server.stop();
		}
	});

	test("agent ask has no timeout unless --timeout is passed", () => {
		expect(parseAskArgs(["--to", "mimi", "hello", "there"])).toEqual({
			message: "hello there",
			target: "mimi",
			timeoutSeconds: undefined,
		});
		expect(
			parseAskArgs(["--to", "mimi", "--timeout", "10", "hello", "there"]),
		).toEqual({
			message: "hello there",
			target: "mimi",
			timeoutSeconds: 10,
		});
	});

	test("agent ask times out only when --timeout is passed", async () => {
		createAgentHome("railly", "agent-railly");
		createAgentHome("mimi", "agent-mimi");
		const server = createTestServer({
			port: 0,
			fetch(req, websocketServer) {
				if (websocketServer.upgrade(req)) {
					return;
				}
				return new Response("ok");
			},
			websocket: {
				message() {},
			},
		});
		writeConfig(server.port as number);

		try {
			const result = await runCliAsync(
				["agent", "ask", "--to", "mimi", "--timeout", "1", "hi there"],
				{
					cwd: join(OUTCLAW_DIR, "agents", "railly"),
				},
			);
			expect(result.exitCode).toBe(124);
			expect(result.stderr).toContain("agent ask timed out after 1s");
		} finally {
			server.stop();
		}
	});

	test("agent ask exits when the control connection closes before a response", async () => {
		createAgentHome("railly", "agent-railly");
		createAgentHome("mimi", "agent-mimi");
		const server = createTestServer({
			port: 0,
			fetch(req, websocketServer) {
				if (websocketServer.upgrade(req)) {
					return;
				}
				return new Response("ok");
			},
			websocket: {
				message() {},
				open(ws) {
					ws.close();
				},
			},
		});
		writeConfig(server.port as number);

		try {
			const result = await runCliAsync(
				["agent", "ask", "--to", "mimi", "hi there"],
				{
					cwd: join(OUTCLAW_DIR, "agents", "railly"),
				},
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain(
				"agent ask connection closed before response",
			);
		} finally {
			server.stop();
		}
	});

	test("cron run sends a cwd-scoped control request and prints nothing on acceptance", async () => {
		const agentHome = createAgentHome("railly", "agent-railly");
		const server = createTestServer({
			port: 0,
			fetch(req, websocketServer) {
				if (websocketServer.upgrade(req)) {
					return;
				}
				return new Response("ok");
			},
			websocket: {
				message(ws, rawMessage) {
					const message = JSON.parse(String(rawMessage));
					expect(message).toEqual({
						type: "cron_run",
						cwd: agentHome,
						jobName: "memory-distill",
					});
					ws.send(
						JSON.stringify({
							type: "cron_run_response",
							jobName: "memory-distill",
						}),
					);
				},
			},
		});
		writeConfig(server.port as number);

		try {
			const result = await runCliAsync(["cron", "run", "memory-distill"], {
				cwd: agentHome,
			});
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe("");
			expect(result.stderr).toBe("");
		} finally {
			server.stop();
		}
	});

	test("cron run prints daemon control errors to stderr", async () => {
		const agentHome = createAgentHome("railly", "agent-railly");
		const server = createTestServer({
			port: 0,
			fetch(req, websocketServer) {
				if (websocketServer.upgrade(req)) {
					return;
				}
				return new Response("ok");
			},
			websocket: {
				message(ws) {
					ws.send(
						JSON.stringify({
							type: "cron_run_error",
							message: "Cron job not found: missing",
						}),
					);
				},
			},
		});
		writeConfig(server.port as number);

		try {
			const result = await runCliAsync(["cron", "run", "missing"], {
				cwd: agentHome,
			});
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("Cron job not found: missing");
		} finally {
			server.stop();
		}
	});

	test("coding start posts cwd and prompt to the daemon coding API and prints the session ref", async () => {
		const projectDir = join(TEST_HOME, "projects", "demo");
		mkdirSync(projectDir, { recursive: true });
		let requestSeen = false;
		const server = createTestServer({
			port: 0,
			async fetch(req) {
				const url = new URL(req.url);
				if (url.pathname !== "/api/coding/sessions") {
					return new Response("not found", { status: 404 });
				}
				requestSeen = true;
				expect(req.method).toBe("POST");
				expect(await req.json()).toEqual({
					cwd: projectDir,
					prompt: "go build it",
				});
				return Response.json({
					status: "accepted",
					providerId: "codex",
					sdkSessionId: "codex-session-1",
				});
			},
		});
		writeConfig(server.port as number);

		try {
			const result = await runCliAsync(
				["coding", "start", projectDir, "go", "build", "it"],
				{ cwd: TEST_HOME },
			);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe("codex/codex-session-1");
			expect(result.stderr).toBe("");
			expect(requestSeen).toBe(true);
		} finally {
			server.stop();
		}
	});

	test("coding start attaches active chat context when run from an agent home", async () => {
		const agentHome = createAgentHome("railly", "agent-railly");
		const projectDir = join(TEST_HOME, "projects", "demo");
		mkdirSync(projectDir, { recursive: true });
		const seen: string[] = [];
		const server = createTestServer({
			port: 0,
			async fetch(req) {
				const url = new URL(req.url);
				if (url.pathname === "/api/agents/agent-railly/active-session") {
					seen.push("active-session");
					expect(req.method).toBe("GET");
					return Response.json({
						activeSession: {
							providerId: "claude",
							sdkSessionId: "chat-session-1",
						},
					});
				}
				if (url.pathname !== "/api/coding/sessions") {
					return new Response("not found", { status: 404 });
				}
				seen.push("coding-start");
				expect(req.headers.get("x-outclaw-chat-agent-id")).toBe("agent-railly");
				expect(req.headers.get("x-outclaw-chat-provider-id")).toBe("claude");
				expect(req.headers.get("x-outclaw-chat-session-id")).toBe(
					"chat-session-1",
				);
				expect(await req.json()).toEqual({
					cwd: projectDir,
					prompt: "go build it",
				});
				return Response.json({
					status: "accepted",
					providerId: "codex",
					sdkSessionId: "codex-session-1",
				});
			},
		});
		writeConfig(server.port as number);

		try {
			const result = await runCliAsync(
				["coding", "start", projectDir, "go", "build", "it"],
				{ cwd: agentHome },
			);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe("codex/codex-session-1");
			expect(result.stderr).toBe("");
			expect(seen).toEqual(["active-session", "coding-start"]);
		} finally {
			server.stop();
		}
	});

	test("coding short form starts when the target is a path", async () => {
		const projectDir = join(TEST_HOME, "projects", "demo");
		mkdirSync(projectDir, { recursive: true });
		let requestSeen = false;
		const server = createTestServer({
			port: 0,
			async fetch(req) {
				const url = new URL(req.url);
				if (url.pathname !== "/api/coding/sessions") {
					return new Response("not found", { status: 404 });
				}
				requestSeen = true;
				expect(req.method).toBe("POST");
				expect(await req.json()).toEqual({
					cwd: projectDir,
					prompt: "go build it",
				});
				return Response.json({
					status: "accepted",
					providerId: "codex",
					sdkSessionId: "codex-session-1",
				});
			},
		});
		writeConfig(server.port as number);

		try {
			const result = await runCliAsync(
				["coding", projectDir, "go", "build", "it"],
				{ cwd: TEST_HOME },
			);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe("codex/codex-session-1");
			expect(result.stderr).toBe("");
			expect(requestSeen).toBe(true);
		} finally {
			server.stop();
		}
	});

	test("coding short form starts when the target is a registered repo id", async () => {
		let requestSeen = false;
		const server = createTestServer({
			port: 0,
			async fetch(req) {
				const url = new URL(req.url);
				if (url.pathname !== "/api/coding/sessions") {
					return new Response("not found", { status: 404 });
				}
				requestSeen = true;
				expect(req.method).toBe("POST");
				expect(await req.json()).toEqual({
					repositoryId: "outclaw",
					prompt: "go build it",
				});
				return Response.json({
					status: "accepted",
					providerId: "codex",
					sdkSessionId: "codex-session-1",
				});
			},
		});
		writeConfig(server.port as number);

		try {
			const result = await runCliAsync(
				["coding", "outclaw", "go", "build", "it"],
				{ cwd: TEST_HOME },
			);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe("codex/codex-session-1");
			expect(result.stderr).toBe("");
			expect(requestSeen).toBe(true);
		} finally {
			server.stop();
		}
	});

	test("coding resume posts the follow-up prompt to the daemon coding API and prints the session ref", async () => {
		let requestSeen = false;
		const server = createTestServer({
			port: 0,
			async fetch(req) {
				const url = new URL(req.url);
				if (
					url.pathname !== "/api/coding/sessions/codex/codex-session-1/resume"
				) {
					return new Response("not found", { status: 404 });
				}
				requestSeen = true;
				expect(req.method).toBe("POST");
				expect(await req.json()).toEqual({
					prompt: "polish the implementation",
				});
				return Response.json({
					status: "accepted",
					providerId: "codex",
					sdkSessionId: "codex-session-1",
				});
			},
		});
		writeConfig(server.port as number);

		try {
			const result = await runCliAsync(
				[
					"coding",
					"resume",
					"codex/codex-session-1",
					"polish",
					"the",
					"implementation",
				],
				{ cwd: TEST_HOME },
			);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe("codex/codex-session-1");
			expect(result.stderr).toBe("");
			expect(requestSeen).toBe(true);
		} finally {
			server.stop();
		}
	});

	test("coding short form resumes when the target is an explicit session ref", async () => {
		let requestSeen = false;
		const server = createTestServer({
			port: 0,
			async fetch(req) {
				const url = new URL(req.url);
				if (
					url.pathname !== "/api/coding/sessions/codex/codex-session-1/resume"
				) {
					return new Response("not found", { status: 404 });
				}
				requestSeen = true;
				expect(req.method).toBe("POST");
				expect(await req.json()).toEqual({
					prompt: "polish the implementation",
				});
				return Response.json({
					status: "accepted",
					providerId: "codex",
					sdkSessionId: "codex-session-1",
				});
			},
		});
		writeConfig(server.port as number);

		try {
			const result = await runCliAsync(
				["coding", "codex/codex-session-1", "polish", "the", "implementation"],
				{ cwd: TEST_HOME },
			);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe("codex/codex-session-1");
			expect(result.stderr).toBe("");
			expect(requestSeen).toBe(true);
		} finally {
			server.stop();
		}
	});

	test("coding short form resumes an explicit session ref even when a matching relative path exists", async () => {
		mkdirSync(join(TEST_HOME, "codex", "codex-session-1"), {
			recursive: true,
		});
		let requestSeen = false;
		const server = createTestServer({
			port: 0,
			async fetch(req) {
				const url = new URL(req.url);
				if (
					url.pathname !== "/api/coding/sessions/codex/codex-session-1/resume"
				) {
					return new Response("not found", { status: 404 });
				}
				requestSeen = true;
				expect(req.method).toBe("POST");
				expect(await req.json()).toEqual({
					prompt: "polish the implementation",
				});
				return Response.json({
					status: "accepted",
					providerId: "codex",
					sdkSessionId: "codex-session-1",
				});
			},
		});
		writeConfig(server.port as number);

		try {
			const result = await runCliAsync(
				["coding", "codex/codex-session-1", "polish", "the", "implementation"],
				{ cwd: TEST_HOME },
			);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe("codex/codex-session-1");
			expect(result.stderr).toBe("");
			expect(requestSeen).toBe(true);
		} finally {
			server.stop();
		}
	});

	test("coding status prints done and the final assistant response", async () => {
		let requestSeen = false;
		const server = createTestServer({
			port: 0,
			fetch(req) {
				const url = new URL(req.url);
				if (
					url.pathname !== "/api/coding/sessions/codex/codex-session-1/status"
				) {
					return new Response("not found", { status: 404 });
				}
				requestSeen = true;
				expect(req.method).toBe("GET");
				return Response.json({
					providerId: "codex",
					sdkSessionId: "codex-session-1",
					state: "done",
					finalResponse: "final answer",
				});
			},
		});
		writeConfig(server.port as number);

		try {
			const result = await runCliAsync(
				["coding", "status", "codex/codex-session-1"],
				{ cwd: TEST_HOME },
			);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe("done\n\nfinal answer");
			expect(result.stderr).toBe("");
			expect(requestSeen).toBe(true);
		} finally {
			server.stop();
		}
	});

	test("coding status attaches active chat context when run from an agent home", async () => {
		const agentHome = createAgentHome("railly", "agent-railly");
		const seen: string[] = [];
		const server = createTestServer({
			port: 0,
			fetch(req) {
				const url = new URL(req.url);
				if (url.pathname === "/api/agents/agent-railly/active-session") {
					seen.push("active-session");
					return Response.json({
						activeSession: {
							providerId: "claude",
							sdkSessionId: "chat-session-1",
						},
					});
				}
				if (
					url.pathname !== "/api/coding/sessions/codex/codex-session-1/status"
				) {
					return new Response("not found", { status: 404 });
				}
				seen.push("coding-status");
				expect(req.headers.get("x-outclaw-chat-agent-id")).toBe("agent-railly");
				expect(req.headers.get("x-outclaw-chat-provider-id")).toBe("claude");
				expect(req.headers.get("x-outclaw-chat-session-id")).toBe(
					"chat-session-1",
				);
				return Response.json({
					providerId: "codex",
					sdkSessionId: "codex-session-1",
					state: "done",
					finalResponse: "final answer",
				});
			},
		});
		writeConfig(server.port as number);

		try {
			const result = await runCliAsync(
				["coding", "status", "codex/codex-session-1"],
				{ cwd: agentHome },
			);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe("done\n\nfinal answer");
			expect(result.stderr).toBe("");
			expect(seen).toEqual(["active-session", "coding-status"]);
		} finally {
			server.stop();
		}
	});

	test("coding status prints running and error states without failing the command", async () => {
		const responses = new Map([
			[
				"/api/coding/sessions/codex/running-session/status",
				{
					providerId: "codex",
					sdkSessionId: "running-session",
					state: "running",
				},
			],
			[
				"/api/coding/sessions/codex/error-session/status",
				{
					providerId: "codex",
					sdkSessionId: "error-session",
					state: "error",
					error: "boom",
				},
			],
		]);
		const server = createTestServer({
			port: 0,
			fetch(req) {
				const url = new URL(req.url);
				const response = responses.get(url.pathname);
				if (!response) {
					return new Response("not found", { status: 404 });
				}
				expect(req.method).toBe("GET");
				return Response.json(response);
			},
		});
		writeConfig(server.port as number);

		try {
			const running = await runCliAsync(
				["coding", "status", "codex/running-session"],
				{ cwd: TEST_HOME },
			);
			expect(running.exitCode).toBe(0);
			expect(running.stdout).toBe("running");
			expect(running.stderr).toBe("");

			const failed = await runCliAsync(
				["coding", "status", "codex/error-session"],
				{ cwd: TEST_HOME },
			);
			expect(failed.exitCode).toBe(0);
			expect(failed.stdout).toBe("error: boom");
			expect(failed.stderr).toBe("");
		} finally {
			server.stop();
		}
	});

	test("coding transcript renders normalized replay events without following", async () => {
		let eventsSeen = false;
		let followParam: string | null | undefined;
		const frame = (sequence: number, event: Record<string, unknown>): string =>
			`id: ${sequence}\ndata: ${JSON.stringify({
				providerId: "codex",
				sdkSessionId: "codex-session-1",
				sequence,
				event,
				createdAt: sequence,
			})}\n\n`;
		const server = createTestServer({
			port: 0,
			fetch(req) {
				const url = new URL(req.url);
				if (
					url.pathname !== "/api/coding/sessions/codex/codex-session-1/events"
				) {
					return new Response("not found", { status: 404 });
				}
				eventsSeen = true;
				expect(req.method).toBe("GET");
				followParam = url.searchParams.get("follow");
				const encoder = new TextEncoder();
				return new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(
								encoder.encode(
									frame(1, {
										type: "user_prompt",
										text: "go build it",
										sessionId: "codex-session-1",
									}),
								),
							);
							controller.enqueue(
								encoder.encode(
									frame(2, {
										type: "command_execution_started",
										callId: "cmd-1",
										command: "bun test",
										sessionId: "codex-session-1",
									}),
								),
							);
							controller.enqueue(
								encoder.encode(
									frame(3, {
										type: "command_execution_output",
										callId: "cmd-1",
										output: "tests passed\n",
										sessionId: "codex-session-1",
									}),
								),
							);
							controller.enqueue(
								encoder.encode(
									frame(4, {
										type: "command_execution_completed",
										callId: "cmd-1",
										exitCode: 0,
										sessionId: "codex-session-1",
									}),
								),
							);
							controller.enqueue(
								encoder.encode(
									frame(5, {
										type: "file_change_applied",
										callId: "patch-1",
										changes: [{ kind: "update", path: "src/app.ts" }],
										sessionId: "codex-session-1",
									}),
								),
							);
							controller.enqueue(
								encoder.encode(
									frame(6, {
										type: "text",
										text: "Implemented transcript.",
										sessionId: "codex-session-1",
									}),
								),
							);
							controller.enqueue(
								encoder.encode(
									frame(7, {
										type: "done",
										sessionId: "codex-session-1",
										durationMs: 1500,
									}),
								),
							);
							controller.close();
						},
					}),
					{
						headers: {
							"content-type": "text/event-stream; charset=utf-8",
						},
					},
				);
			},
		});
		writeConfig(server.port as number);

		try {
			const result = await runCliAsyncWithTimeout(
				["coding", "transcript", "codex/codex-session-1", "--full"],
				{ cwd: TEST_HOME, timeoutMs: 1000 },
			);
			expect(result.timedOut).toBe(false);
			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
			expect(result.stdout).toContain("[user] go build it");
			expect(result.stdout).toContain("[command] bun test");
			expect(result.stdout).toContain("tests passed");
			expect(result.stdout).toContain("[command exited 0]");
			expect(result.stdout).toContain("[file] update src/app.ts");
			expect(result.stdout).toContain("Implemented transcript.");
			expect(result.stdout).toContain("[done] 1.5s");
			expect(eventsSeen).toBe(true);
			expect(followParam).toBe("false");
		} finally {
			server.stop();
		}
	});

	test("coding transcript defaults to the latest interaction turn", async () => {
		const frame = (sequence: number, event: Record<string, unknown>): string =>
			`id: ${sequence}\ndata: ${JSON.stringify({
				providerId: "codex",
				sdkSessionId: "done-session",
				sequence,
				event,
				createdAt: sequence,
			})}\n\n`;
		const server = createTestServer({
			port: 0,
			fetch(req) {
				const url = new URL(req.url);
				if (url.pathname !== "/api/coding/sessions/codex/done-session/events") {
					return new Response("not found", { status: 404 });
				}
				return new Response(
					[
						frame(1, {
							type: "session_initialized",
							sessionId: "done-session",
						}),
						frame(2, {
							type: "user_prompt",
							text: "first prompt",
							sessionId: "done-session",
						}),
						frame(3, {
							type: "text",
							text: "first result\n",
							sessionId: "done-session",
						}),
						frame(4, {
							type: "done",
							sessionId: "done-session",
							durationMs: 10,
						}),
						frame(5, {
							type: "user_prompt",
							text: "check roman numerals",
							sessionId: "done-session",
						}),
						frame(6, {
							type: "text",
							text: "```text\n",
							sessionId: "done-session",
						}),
						frame(7, {
							type: "text",
							text: "I\nIV\nIX\n",
							sessionId: "done-session",
						}),
						frame(8, {
							type: "text",
							text: "```\n",
							sessionId: "done-session",
						}),
						frame(9, {
							type: "done",
							sessionId: "done-session",
							durationMs: 35200,
						}),
					].join(""),
					{
						headers: {
							"content-type": "text/event-stream; charset=utf-8",
						},
					},
				);
			},
		});
		writeConfig(server.port as number);

		try {
			const result = await runCliAsyncWithTimeout(
				["coding", "transcript", "codex/done-session"],
				{ cwd: TEST_HOME, timeoutMs: 1000 },
			);
			expect(result.timedOut).toBe(false);
			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
			expect(result.stdout).toStartWith("[user] check roman numerals\n");
			expect(result.stdout).not.toContain("first prompt");
			expect(result.stdout).toContain("```text\nI\nIV\nIX\n```\n");
			expect(result.stdout).toContain("[done] 35.2s");
		} finally {
			server.stop();
		}
	});

	test("coding transcript supports an explicit interaction turn count", async () => {
		const frame = (
			sdkSessionId: string,
			sequence: number,
			event: Record<string, unknown>,
		): string =>
			`id: ${sequence}\ndata: ${JSON.stringify({
				providerId: "codex",
				sdkSessionId,
				sequence,
				event,
				createdAt: sequence,
			})}\n\n`;
		const server = createTestServer({
			port: 0,
			fetch(req) {
				const url = new URL(req.url);
				if (url.pathname === "/api/coding/sessions/codex/done-session/events") {
					return new Response(
						[
							frame("done-session", 1, {
								type: "user_prompt",
								text: "first prompt",
								sessionId: "done-session",
							}),
							frame("done-session", 2, {
								type: "text",
								text: "first result\n",
								sessionId: "done-session",
							}),
							frame("done-session", 3, {
								type: "done",
								sessionId: "done-session",
								durationMs: 42,
							}),
							frame("done-session", 4, {
								type: "user_prompt",
								text: "second prompt",
								sessionId: "done-session",
							}),
							frame("done-session", 5, {
								type: "text",
								text: "second result\n",
								sessionId: "done-session",
							}),
							frame("done-session", 6, {
								type: "done",
								sessionId: "done-session",
								durationMs: 43,
							}),
							frame("done-session", 7, {
								type: "user_prompt",
								text: "third prompt",
								sessionId: "done-session",
							}),
							frame("done-session", 8, {
								type: "text",
								text: "third result\n",
								sessionId: "done-session",
							}),
							frame("done-session", 9, {
								type: "done",
								sessionId: "done-session",
								durationMs: 44,
							}),
						].join(""),
						{
							headers: {
								"content-type": "text/event-stream; charset=utf-8",
							},
						},
					);
				}
				return new Response("not found", { status: 404 });
			},
		});
		writeConfig(server.port as number);

		try {
			const done = await runCliAsyncWithTimeout(
				["coding", "transcript", "codex/done-session", "--turns", "2"],
				{ cwd: TEST_HOME, timeoutMs: 1000 },
			);
			expect(done.timedOut).toBe(false);
			expect(done.stderr).toBe("");
			expect(done.exitCode).toBe(0);
			expect(done.stdout).not.toContain("[user] first prompt");
			expect(done.stdout).toStartWith("[user] second prompt\n");
			expect(done.stdout).toContain("second result\n");
			expect(done.stdout).toContain("[user] third prompt");
			expect(done.stdout).toContain("third result\n");
		} finally {
			server.stop();
		}
	});

	test("coding transcript rejects malformed turn counts", async () => {
		const result = await runCliAsync(
			["coding", "transcript", "codex/done-session", "--turns=2x"],
			{},
		);

		expect(result.exitCode).toBe(1);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain(
			"Transcript turn count must be a positive integer",
		);
	});

	test("coding monitor is no longer an agent-facing command", async () => {
		const result = await runCliAsync(
			["coding", "monitor", "codex/codex-session-1"],
			{},
		);

		expect(result.exitCode).toBe(1);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("oc coding monitor was removed");
	});

	test("coding start prints daemon rejection messages to stderr", async () => {
		const projectDir = join(TEST_HOME, "projects", "demo");
		mkdirSync(projectDir, { recursive: true });
		const server = createTestServer({
			port: 0,
			fetch(req) {
				const url = new URL(req.url);
				if (url.pathname !== "/api/coding/sessions") {
					return new Response("not found", { status: 404 });
				}
				return Response.json({
					status: "rejected",
					message: "Coding service is not configured",
				});
			},
		});
		writeConfig(server.port as number);

		try {
			const result = await runCliAsync(
				["coding", "start", projectDir, "go build it"],
				{ cwd: TEST_HOME },
			);
			expect(result.exitCode).toBe(1);
			expect(result.stdout).toBe("");
			expect(result.stderr).toBe("Coding service is not configured");
		} finally {
			server.stop();
		}
	});

	test("coding start treats help-looking prompt words as prompt content", async () => {
		const projectDir = join(TEST_HOME, "projects", "demo");
		mkdirSync(projectDir, { recursive: true });
		const server = createTestServer({
			port: 0,
			async fetch(req) {
				const url = new URL(req.url);
				if (url.pathname !== "/api/coding/sessions") {
					return new Response("not found", { status: 404 });
				}
				expect(await req.json()).toEqual({
					cwd: projectDir,
					prompt: "fix --help output",
				});
				return Response.json({
					status: "accepted",
					providerId: "codex",
					sdkSessionId: "codex-session-1",
				});
			},
		});
		writeConfig(server.port as number);

		try {
			const result = await runCliAsync(
				["coding", "start", projectDir, "fix", "--help", "output"],
				{ cwd: TEST_HOME },
			);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe("codex/codex-session-1");
		} finally {
			server.stop();
		}
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

		const result = runCli(["config", "secure"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("config.json");
		expect(result.stdout).toContain("RAILLY_TELEGRAM_BOT_TOKEN");
		expect(result.stdout).toContain("RAILLY_TELEGRAM_USERS");

		expect(
			JSON.parse(readFileSync(join(OUTCLAW_DIR, "config.json"), "utf-8")),
		).toEqual({
			autoCompact: false,
			host: "127.0.0.1",
			heartbeat: { intervalMinutes: 60, deferMinutes: 2 },
			port: 4100,
			thinkingEffort: "medium",
			agents: {
				"agent-railly": {
					rollover: {
						idleMinutes: 240,
					},
					telegram: {
						botToken: "$RAILLY_TELEGRAM_BOT_TOKEN",
						allowedUsers: "$RAILLY_TELEGRAM_USERS",
					},
				},
				"agent-mimi": {
					rollover: {
						idleMinutes: 240,
					},
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

	test("config secure does not restart the daemon when it changes config", async () => {
		mkdirSync(join(OUTCLAW_DIR, "agents", "railly"), { recursive: true });
		writeFileSync(
			join(OUTCLAW_DIR, "agents", "railly", ".agent-id"),
			"agent-railly\n",
		);
		writeFileSync(
			join(OUTCLAW_DIR, "config.json"),
			JSON.stringify(
				{
					autoCompact: false,
					heartbeat: { intervalMinutes: 60, deferMinutes: 2 },
					port: 0,
					agents: {
						"agent-railly": {
							telegram: {
								botToken: "token-a",
								allowedUsers: [101, 202],
							},
						},
					},
				},
				null,
				"\t",
			),
		);

		expect(runCli(["start"]).exitCode).toBe(0);
		const originalPid = readPid();

		const result = runCli(["config", "secure"]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Updated .env");
		expect(result.stdout).toContain("Restart required");
		expect(readPid()).toBe(originalPid);
		expect(await waitForFrontendNotice()).toEqual({ kind: "restart_required" });
	});

	test("config runtime updates global runtime settings", () => {
		mkdirSync(OUTCLAW_DIR, { recursive: true });
		writeFileSync(
			join(OUTCLAW_DIR, "config.json"),
			JSON.stringify(
				{
					autoCompact: true,
					host: "127.0.0.1",
					heartbeat: { intervalMinutes: 30, deferMinutes: 0 },
					port: 4000,
					thinkingEffort: "medium",
					custom: { note: "preserve me" },
				},
				null,
				"\t",
			),
		);

		const result = runCli([
			"config",
			"runtime",
			"--host",
			"0.0.0.0",
			"--port",
			"4100",
			"--auto-compact",
			"false",
			"--heartbeat-interval",
			"60",
			"--heartbeat-defer",
			"5",
			"--thinking-effort",
			"low",
		]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Configured runtime settings");
		expect(
			JSON.parse(readFileSync(join(OUTCLAW_DIR, "config.json"), "utf-8")),
		).toEqual({
			autoCompact: false,
			host: "0.0.0.0",
			heartbeat: { intervalMinutes: 60, deferMinutes: 5 },
			port: 4100,
			thinkingEffort: "low",
			custom: { note: "preserve me" },
		});
	});

	test("config runtime creates config.json when the outclaw home does not exist", () => {
		const result = runCli(["config", "runtime", "--port", "4100"]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Configured runtime settings");
		expect(
			JSON.parse(readFileSync(join(OUTCLAW_DIR, "config.json"), "utf-8")),
		).toEqual({
			autoCompact: true,
			host: "127.0.0.1",
			heartbeat: { intervalMinutes: 30, deferMinutes: 0 },
			port: 4100,
			thinkingEffort: "medium",
		});
	});

	test("config runtime does not restart the daemon when it is running", async () => {
		runCli(["agent", "create", "railly"]);
		writeConfig(0);
		expect(runCli(["start"]).exitCode).toBe(0);
		const originalPid = readPid();

		const result = runCli(["config", "runtime", "--heartbeat-interval", "45"]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Configured runtime settings");
		expect(result.stdout).toContain("Restart required");
		expect(readPid()).toBe(originalPid);
		expect(await waitForFrontendNotice()).toEqual({ kind: "restart_required" });
	});

	test("config runtime rejects invalid values", () => {
		const result = runCli(["config", "runtime", "--auto-compact", "maybe"]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			"Invalid --auto-compact value: maybe (expected true or false)",
		);
	});

	test("config runtime rejects invalid thinking effort values", () => {
		const result = runCli(["config", "runtime", "--thinking-effort", "turbo"]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			"Invalid --thinking-effort value: turbo (expected one of: low, medium, high, xhigh, max)",
		);
	});

	test("session list defaults to chat sessions and scopes by cwd agent when available", () => {
		const raillyHome = createAgentHome("railly", "agent-railly");
		createAgentHome("mimi", "agent-mimi");
		seedSession({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: "railly-chat-1234567890",
			title: "Railly chat",
			createdAt: Date.parse("2025-01-15T14:30:00.000Z"),
			lastActive: Date.parse("2025-01-20T09:15:00.000Z"),
		});
		seedSession({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: "railly-cron-1234567890",
			title: "Railly cron",
			tag: "cron",
			createdAt: Date.parse("2025-01-19T08:00:00.000Z"),
			lastActive: Date.parse("2025-01-19T08:00:00.000Z"),
		});
		seedSession({
			agentId: "agent-mimi",
			providerId: "claude",
			sdkSessionId: "mimi-chat-1234567890",
			title: "Mimi chat",
			createdAt: Date.parse("2025-01-14T10:22:00.000Z"),
			lastActive: Date.parse("2025-01-18T16:45:00.000Z"),
		});

		const globalResult = runCli(["session", "list"]);
		expect(globalResult.exitCode).toBe(0);
		expect(globalResult.stdout).toBe(
			[
				"agent\tid\ttitle\tcreated\tlast_active",
				"railly\trailly-chat-\tRailly chat\t2025-01-15 14:30\t2025-01-20 09:15",
				"mimi\tmimi-chat-12\tMimi chat\t2025-01-14 10:22\t2025-01-18 16:45",
			].join("\n"),
		);

		const scopedResult = runCli(["session", "list"], { cwd: raillyHome });
		expect(scopedResult.exitCode).toBe(0);
		expect(scopedResult.stdout).toBe(
			[
				"agent\tid\ttitle\tcreated\tlast_active",
				"railly\trailly-chat-\tRailly chat\t2025-01-15 14:30\t2025-01-20 09:15",
			].join("\n"),
		);

		const cronResult = runCli(["session", "list", "--tag", "cron"], {
			cwd: raillyHome,
		});
		expect(cronResult.exitCode).toBe(0);
		expect(cronResult.stdout).toBe(
			[
				"agent\tid\ttitle\tcreated\tlast_active",
				"railly\trailly-cron-\tRailly cron\t2025-01-19 08:00\t2025-01-19 08:00",
			].join("\n"),
		);
	});

	test("cron status --failed lists failed cron runs scoped by cwd", () => {
		const raillyHome = createAgentHome("railly", "agent-railly");
		createAgentHome("mimi", "agent-mimi");
		seedSession({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: "railly-cron-success",
			title: "daily-summary",
			tag: "cron",
			createdAt: Date.parse("2025-01-20T08:00:00.000Z"),
			lastActive: Date.parse("2025-01-20T08:00:00.000Z"),
		});
		seedSession({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: "railly-cron-failed-1",
			title: "memory-route",
			tag: "cron",
			createdAt: Date.parse("2025-01-20T09:00:00.000Z"),
			lastActive: Date.parse("2025-01-20T09:00:00.000Z"),
			failedAt: Date.parse("2025-01-20T09:01:00.000Z"),
			failureMessage: "agent exploded",
		});
		seedSession({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: "railly-cron-failed-2",
			title: "daily-summary",
			tag: "cron",
			createdAt: Date.parse("2025-01-19T09:00:00.000Z"),
			lastActive: Date.parse("2025-01-19T09:00:00.000Z"),
			failedAt: Date.parse("2025-01-19T09:01:00.000Z"),
			failureMessage: "network timeout",
		});
		seedSession({
			agentId: "agent-mimi",
			providerId: "claude",
			sdkSessionId: "mimi-cron-failed",
			title: "daily-summary",
			tag: "cron",
			createdAt: Date.parse("2025-01-20T10:00:00.000Z"),
			lastActive: Date.parse("2025-01-20T10:00:00.000Z"),
			failedAt: Date.parse("2025-01-20T10:01:00.000Z"),
			failureMessage: "other agent failed",
		});

		const result = runCli(
			["cron", "status", "--failed", "--since", "2025-01-20T00:00:00.000Z"],
			{ cwd: raillyHome },
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe(
			[
				"agent\tjob\tid\tfailed_at\terror",
				"railly\tmemory-route\trailly-cron-\t2025-01-20 09:01\tagent exploded",
			].join("\n"),
		);
	});

	test("cron status --failed --names prints unique failed job names", () => {
		const raillyHome = createAgentHome("railly", "agent-railly");
		seedSession({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: "railly-cron-failed-1",
			title: "memory-route",
			tag: "cron",
			createdAt: Date.parse("2025-01-20T09:00:00.000Z"),
			lastActive: Date.parse("2025-01-20T09:00:00.000Z"),
			failedAt: Date.parse("2025-01-20T09:01:00.000Z"),
			failureMessage: "agent exploded",
		});
		seedSession({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: "railly-cron-failed-2",
			title: "daily-summary",
			tag: "cron",
			createdAt: Date.parse("2025-01-19T09:00:00.000Z"),
			lastActive: Date.parse("2025-01-19T09:00:00.000Z"),
			failedAt: Date.parse("2025-01-19T09:01:00.000Z"),
			failureMessage: "network timeout",
		});
		seedSession({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: "railly-cron-failed-3",
			title: "memory-route",
			tag: "cron",
			createdAt: Date.parse("2025-01-18T09:00:00.000Z"),
			lastActive: Date.parse("2025-01-18T09:00:00.000Z"),
			failedAt: Date.parse("2025-01-18T09:01:00.000Z"),
			failureMessage: "old failure",
		});

		const result = runCli(
			[
				"cron",
				"status",
				"--failed",
				"--since",
				"2025-01-01T00:00:00.000Z",
				"--names",
			],
			{ cwd: raillyHome },
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe(["memory-route", "daily-summary"].join("\n"));
	});

	test("session transcript resolves a scoped prefix and prints timestamped turns", () => {
		const raillyHome = createAgentHome("railly", "agent-railly");
		const sessionId = "a1b2c3d4e5f6b7c8d9e0f1a2b3c4d5e6";
		seedSession({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: sessionId,
			title: "TUI style testing",
			createdAt: Date.parse("2025-01-15T14:30:00.000Z"),
			lastActive: Date.parse("2025-01-20T09:15:00.000Z"),
		});
		const projectDir = join(TEST_HOME, ".claude", "projects", "sample-project");
		mkdirSync(projectDir, { recursive: true });
		writeFileSync(
			join(projectDir, `${sessionId}.jsonl`),
			[
				JSON.stringify({
					type: "user",
					timestamp: "2025-01-15T14:30:00.000Z",
					message: {
						content: [
							{ type: "text", text: "What's the status of the migration?" },
						],
					},
				}),
				JSON.stringify({
					type: "assistant",
					timestamp: "2025-01-15T14:31:00.000Z",
					message: {
						content: [
							{ type: "thinking", thinking: "skip this" },
							{
								type: "text",
								text: "The migration is 80% complete. Remaining tables: users, payments.",
							},
						],
					},
				}),
			].join("\n"),
		);

		const result = runCli(["session", "transcript", "a1b2c3d4e5f6"], {
			cwd: raillyHome,
		});
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe(
			[
				"agent: railly",
				`id: ${sessionId}`,
				"title: TUI style testing",
				"tag: chat",
				"created: 2025-01-15 14:30",
				"last_active: 2025-01-20 09:15",
				"",
				"[user] 2025-01-15 14:30",
				"What's the status of the migration?",
				"",
				"[assistant] 2025-01-15 14:31",
				"The migration is 80% complete. Remaining tables: users, payments.",
			].join("\n"),
		);
	});

	test("session search prints matching turns grouped by session with agent name", () => {
		const raillyHome = createAgentHome("railly", "agent-railly");
		const dbPath = join(OUTCLAW_DIR, "db.sqlite");
		const store = new SessionStore(dbPath, { agentId: "agent-railly" });
		store.upsert({
			providerId: "claude",
			sdkSessionId: "search-session-1234567890",
			title: "Webhook thread",
			model: "opus",
		});
		store.replaceTranscript("claude", "search-session-1234567890", [
			{
				role: "user",
				content: "set up webhook handler",
				timestamp: Date.parse("2025-01-15T14:30:00.000Z"),
			},
			{
				role: "assistant",
				content: "use Stripe signing secret",
				timestamp: Date.parse("2025-01-15T14:31:00.000Z"),
			},
		]);
		store.close();

		const result = runCli(["session", "search", "webhook"], {
			cwd: raillyHome,
		});
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe(
			[
				"session: Webhook thread (search-sessi)",
				"agent: railly",
				"provider: claude",
				"[user] 2025-01-15 14:30",
				"set up webhook handler",
			].join("\n"),
		);
	});

	test("session search shows agent and provider metadata when spanning all agents", () => {
		createAgentHome("railly", "agent-railly");
		createAgentHome("mimi", "agent-mimi");
		const dbPath = join(OUTCLAW_DIR, "db.sqlite");

		let store = new SessionStore(dbPath, { agentId: "agent-railly" });
		store.upsert({
			providerId: "claude",
			sdkSessionId: "railly-search-session",
			title: "Railly webhook thread",
			model: "opus",
		});
		store.replaceTranscript("claude", "railly-search-session", [
			{
				role: "user",
				content: "webhook rollout notes",
				timestamp: Date.parse("2025-01-15T14:30:00.000Z"),
			},
		]);
		store.close();

		store = new SessionStore(dbPath, { agentId: "agent-mimi" });
		store.upsert({
			providerId: "claude",
			sdkSessionId: "mimi-search-session",
			title: "Mimi webhook thread",
			model: "opus",
		});
		store.replaceTranscript("claude", "mimi-search-session", [
			{
				role: "assistant",
				content: "webhook retry notes",
				timestamp: Date.parse("2025-01-15T14:31:00.000Z"),
			},
		]);
		store.close();

		const result = runCli(["session", "search", "webhook"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("session: Railly webhook thread");
		expect(result.stdout).toContain("agent: railly");
		expect(result.stdout).toContain("provider: claude");
		expect(result.stdout).toContain("session: Mimi webhook thread");
		expect(result.stdout).toContain("agent: mimi");
	});

	test("session search prints No matches when nothing matches", () => {
		const result = runCli(["session", "search", "missing"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("No matches");
	});

	test("session search has no default limit when --limit is omitted", () => {
		const raillyHome = createAgentHome("railly", "agent-railly");
		const dbPath = join(OUTCLAW_DIR, "db.sqlite");
		const store = new SessionStore(dbPath, { agentId: "agent-railly" });

		for (let index = 0; index < 60; index += 1) {
			const sdkSessionId = `search-session-${String(index).padStart(2, "0")}`;
			store.upsert({
				providerId: "claude",
				sdkSessionId,
				title: `Webhook thread ${index}`,
				model: "opus",
			});
			store.replaceTranscript("claude", sdkSessionId, [
				{
					role: "user",
					content: `webhook search result ${index}`,
					timestamp: Date.parse("2025-01-15T14:30:00.000Z") + index,
				},
			]);
		}
		store.close();

		const result = runCli(["session", "search", "webhook"], {
			cwd: raillyHome,
		});
		expect(result.exitCode).toBe(0);
		expect(result.stdout.match(/^session:/gm)).toHaveLength(60);
	});
});
