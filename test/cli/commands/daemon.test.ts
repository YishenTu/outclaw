import { describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDaemonCommands } from "../../../src/cli/commands/daemon.ts";
import { RESTART_WORKER_FLAG } from "../../../src/runtime/process/restart-daemon.ts";
import { captureExitOutput } from "../../helpers/capture-exit.ts";

function createHomeDir() {
	const homeDir = mkdtempSync(join(tmpdir(), "outclaw-daemon-cli-"));
	const agentDir = join(homeDir, "agents", "railly");
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(join(agentDir, ".agent-id"), "agent-railly\n");
	return homeDir;
}

function createBrowserDir() {
	const browserDir = mkdtempSync(join(tmpdir(), "outclaw-browser-cli-"));
	mkdirSync(join(browserDir, "dist"), { recursive: true });
	writeFileSync(join(browserDir, "dist", "index.html"), "<!doctype html>\n");
	return browserDir;
}

function createCommands(options: {
	argv: string[];
	browserDir: string;
	daemonEntry: string;
	env?: NodeJS.ProcessEnv;
	homeDir: string;
	prepareWorkspaces?: (agentHomeDirs: string[]) => void;
	spawnDetachedRestart?: Parameters<
		typeof createDaemonCommands
	>[0]["spawnDetachedRestart"];
}) {
	return createDaemonCommands({
		argv: options.argv,
		browserDir: options.browserDir,
		cliEntry: join(options.homeDir, "cli.ts"),
		daemonEntry: options.daemonEntry,
		...(options.env ? { env: options.env } : {}),
		homeDir: options.homeDir,
		logPath: join(options.homeDir, "daemon.log"),
		pidPath: join(options.homeDir, "daemon.pid"),
		readyPath: join(options.homeDir, "daemon.ready"),
		templatesDir: join(options.homeDir, "templates"),
		tuiEntry: join(options.homeDir, "tui.ts"),
		...(options.prepareWorkspaces
			? { prepareWorkspaces: options.prepareWorkspaces }
			: {}),
		...(options.spawnDetachedRestart
			? { spawnDetachedRestart: options.spawnDetachedRestart }
			: {}),
	});
}

describe("daemon commands", () => {
	test("restart preflights provider workspaces before stopping the existing daemon", async () => {
		const homeDir = createHomeDir();
		const browserDir = createBrowserDir();
		const daemonEntry = join(homeDir, "daemon.ts");
		const pidPath = join(homeDir, "daemon.pid");
		writeFileSync(daemonEntry, "setInterval(() => {}, 1000);\n");
		writeFileSync(pidPath, `${process.pid}\n`);
		const commands = createCommands({
			argv: ["oc", "restart"],
			browserDir,
			daemonEntry,
			homeDir,
			prepareWorkspaces() {
				throw new Error("missing esbuild");
			},
		});

		try {
			await expect(commands.restart()).rejects.toThrow("missing esbuild");
			expect(readFileSync(pidPath, "utf8")).toBe(`${process.pid}\n`);
		} finally {
			rmSync(homeDir, { force: true, recursive: true });
			rmSync(browserDir, { force: true, recursive: true });
		}
	});

	test("restart from an active agent session hands off before stopping the daemon", async () => {
		const homeDir = createHomeDir();
		const browserDir = createBrowserDir();
		const daemonEntry = join(homeDir, "daemon.ts");
		const pidPath = join(homeDir, "daemon.pid");
		const restartLogPath = join(homeDir, "daemon.log.restart");
		writeFileSync(daemonEntry, "setInterval(() => {}, 1000);\n");
		writeFileSync(pidPath, `${process.pid}\n`);
		let spawned:
			| {
					command: string[];
					options: { env: NodeJS.ProcessEnv };
			  }
			| undefined;
		let unrefCalled = false;
		const commands = createCommands({
			argv: ["bun", join(homeDir, "cli.ts"), "restart", "--lan"],
			browserDir,
			daemonEntry,
			env: {
				...process.env,
				OC_MEMORY_ROOT: "/tmp/outclaw-memory",
				OC_SESSION_ID: "oc-session-1",
			},
			homeDir,
			spawnDetachedRestart(command, options) {
				spawned = { command, options };
				return {
					pid: 4321,
					unref() {
						unrefCalled = true;
					},
				};
			},
		});

		try {
			const result = await captureExitOutput(() => commands.restart());

			expect(result.code).toBe(0);
			expect(result.logs).toContain("Daemon restart handed off (pid 4321)");
			expect(result.logs).toContain(`Log: ${restartLogPath}`);
			expect(readFileSync(pidPath, "utf8")).toBe(`${process.pid}\n`);
			expect(readFileSync(restartLogPath, "utf8")).toContain(
				"restart handoff requested",
			);
			expect(spawned?.command).toEqual([
				"bun",
				join(homeDir, "cli.ts"),
				"restart",
				RESTART_WORKER_FLAG,
				"--lan",
			]);
			expect(spawned?.options.env.OC_SESSION_ID).toBeUndefined();
			expect(spawned?.options.env.OC_MEMORY_ROOT).toBeUndefined();
			expect(unrefCalled).toBe(true);
		} finally {
			rmSync(homeDir, { force: true, recursive: true });
			rmSync(browserDir, { force: true, recursive: true });
		}
	});

	test("start truncates stale daemon log content before launching", async () => {
		const homeDir = createHomeDir();
		const browserDir = createBrowserDir();
		const daemonEntry = join(homeDir, "daemon.ts");
		const logPath = join(homeDir, "daemon.log");
		const previousLogPath = join(homeDir, "daemon.log.previous");
		const pidPath = join(homeDir, "daemon.pid");
		const readyPath = join(homeDir, "daemon.ready");
		writeFileSync(logPath, "old crash text that should disappear\n");
		writeFileSync(
			daemonEntry,
			[
				'import { writeFileSync } from "node:fs";',
				`writeFileSync(${JSON.stringify(readyPath)}, "ready\\n");`,
				'console.log("fresh daemon");',
				"setInterval(() => {}, 1000);",
				"",
			].join("\n"),
		);
		const commands = createCommands({
			argv: ["oc", "start"],
			browserDir,
			daemonEntry,
			homeDir,
			prepareWorkspaces: () => undefined,
		});

		try {
			const result = await captureExitOutput(() => commands.start());

			expect(result.code).toBe(0);
			expect(readFileSync(logPath, "utf8")).toContain("fresh daemon");
			expect(readFileSync(logPath, "utf8")).not.toContain("old crash text");
			expect(readFileSync(previousLogPath, "utf8")).toBe(
				"old crash text that should disappear\n",
			);
		} finally {
			if (existsSync(pidPath)) {
				const pid = Number(readFileSync(pidPath, "utf8"));
				if (Number.isFinite(pid)) {
					try {
						process.kill(pid, "SIGTERM");
					} catch {}
				}
			}
			rmSync(homeDir, { force: true, recursive: true });
			rmSync(browserDir, { force: true, recursive: true });
		}
	});
});
