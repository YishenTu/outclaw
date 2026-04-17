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
import { parseAskArgs } from "../src/cli/agent.ts";
import { SessionStore } from "../src/runtime/persistence/session-store.ts";

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

function createAgentHome(name: string, agentId: string) {
	const agentHome = join(OUTCLAW_DIR, "agents", name);
	mkdirSync(agentHome, { recursive: true });
	writeFileSync(join(agentHome, ".agent-id"), `${agentId}\n`);
	return agentHome;
}

function seedSession(params: {
	agentId: string;
	providerId: string;
	sdkSessionId: string;
	title: string;
	tag?: "chat" | "cron";
	createdAt: number;
	lastActive: number;
}) {
	const dbPath = join(OUTCLAW_DIR, "db.sqlite");
	const store = new SessionStore(dbPath, { agentId: params.agentId });
	store.upsert({
		providerId: params.providerId,
		sdkSessionId: params.sdkSessionId,
		title: params.title,
		model: "opus",
		tag: params.tag,
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
				port,
			},
			null,
			"\t",
		),
	);
}

function readFrontendNotice() {
	const store = new SessionStore(join(OUTCLAW_DIR, "db.sqlite"));
	try {
		return store.getFrontendNotice();
	} finally {
		store.close();
	}
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
		expect(stdout).toContain("<start|stop|restart|status|tui|browser|dev");
		expect(stdout).toContain(
			"oc agent <list|create|config|rename|remove|ask|name>",
		);
		expect(exitCode).toBe(1);
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

	test("agent create does not restart the daemon when it is running", () => {
		runCli(["agent", "create", "railly"]);
		writeConfig(0);
		expect(runCli(["start"]).exitCode).toBe(0);
		const originalPid = readPid();

		const result = runCli(["agent", "create", "mimi"]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Created agent mimi");
		expect(result.stdout).toContain("Restart required");
		expect(readPid()).toBe(originalPid);
		expect(readFrontendNotice()).toEqual({ kind: "restart_required" });
	});

	test("agent rename does not restart the daemon when it is running", () => {
		runCli(["agent", "create", "railly"]);
		writeConfig(0);
		expect(runCli(["start"]).exitCode).toBe(0);
		const originalPid = readPid();

		const result = runCli(["agent", "rename", "railly", "mimi"]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Renamed agent railly -> mimi");
		expect(result.stdout).toContain("Restart required");
		expect(readPid()).toBe(originalPid);
		expect(readFrontendNotice()).toEqual({ kind: "restart_required" });
	});

	test("agent remove does not restart the daemon when it is running", () => {
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
		expect(readFrontendNotice()).toEqual({ kind: "restart_required" });
	});

	test("agent remove leaves the daemon running when it removes the last agent", () => {
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
		expect(readFrontendNotice()).toEqual({ kind: "restart_required" });
	});

	test("agent config does not restart the daemon when it is running", () => {
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
		expect(readPid()).toBe(originalPid);
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

	test("agent ask resolves sender from cwd and prints control response", async () => {
		createAgentHome("railly", "agent-railly");
		createAgentHome("mimi", "agent-mimi");
		const server = Bun.serve({
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
		const server = Bun.serve({
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
		const server = Bun.serve({
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
		const server = Bun.serve({
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
