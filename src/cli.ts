#!/usr/bin/env bun
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { stopDaemon } from "./runtime/process/daemon-stop.ts";
import { PidManager } from "./runtime/process/pid-manager.ts";

const HOME_DIR = join(homedir(), ".outclaw");
const PID_PATH = join(HOME_DIR, "daemon.pid");
const LOG_PATH = join(HOME_DIR, "daemon.log");
const DAEMON_ENTRY = join(import.meta.dir, "index.ts");
const TUI_ENTRY = join(import.meta.dir, "tui.ts");

const pid = new PidManager(PID_PATH);
const command = process.argv[2];

switch (command) {
	case "start":
		start();
		break;
	case "stop":
		await stop();
		break;
	case "restart":
		await stop();
		start();
		break;
	case "status":
		status();
		break;
	case "tui":
		tui();
		break;
	case "dev":
		dev();
		break;
	default:
		console.log("Usage: oc <start|stop|restart|status|tui|dev>");
		process.exit(1);
}

function start() {
	mkdirSync(HOME_DIR, { recursive: true });

	if (pid.isRunning()) {
		console.log(`Daemon already running (pid ${pid.read()})`);
		process.exit(1);
	}

	// Clean stale PID file
	pid.remove();

	const logFile = Bun.file(LOG_PATH);
	const child = Bun.spawn(["bun", DAEMON_ENTRY], {
		stdout: logFile,
		stderr: logFile,
		stdin: "ignore",
		env: { ...process.env },
	});

	// Write PID immediately — don't wait for the daemon to write it
	pid.write(child.pid);

	// Wait briefly to confirm it's still alive (catches init crashes)
	setTimeout(() => {
		if (pid.isRunning()) {
			console.log(`Daemon started (pid ${child.pid})`);
			console.log(`Log: ${LOG_PATH}`);
		} else {
			console.log("Daemon failed to start. Check logs:");
			console.log(`  cat ${LOG_PATH}`);
			pid.remove();
			process.exit(1);
		}
		process.exit(0);
	}, 500);
}

async function stop() {
	const result = await stopDaemon(pid);

	if (result.status === "not_running") {
		console.log("Daemon is not running");
		return;
	}

	if (result.status === "timeout") {
		console.error(`Warning: daemon (pid ${result.pid}) did not exit within 5s`);
		process.exit(1);
	}

	console.log(`Daemon stopped (pid ${result.pid})`);
}

function status() {
	const runningPid = pid.read();
	if (runningPid && pid.isRunning()) {
		console.log(`Daemon running (pid ${runningPid})`);
	} else {
		console.log("Daemon is not running");
		if (runningPid) pid.remove();
	}
}

function dev() {
	mkdirSync(HOME_DIR, { recursive: true });

	if (pid.isRunning()) {
		console.log(
			`Daemon already running (pid ${pid.read()}). Stop it first: oc stop`,
		);
		process.exit(1);
	}

	// Run daemon in foreground with hot reload
	Bun.spawnSync(["bun", "--hot", DAEMON_ENTRY], {
		stdio: ["inherit", "inherit", "inherit"],
		env: { ...process.env },
	});
}

function tui() {
	if (!pid.isRunning()) {
		console.log("Daemon is not running. Start it first: oc start");
		process.exit(1);
	}

	const watch = process.argv.includes("--watch");
	const args = watch ? ["bun", "--watch", TUI_ENTRY] : ["bun", TUI_ENTRY];
	Bun.spawnSync(args, {
		stdio: ["inherit", "inherit", "inherit"],
		env: { ...process.env },
	});
}
