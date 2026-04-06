#!/usr/bin/env bun
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PidManager } from "./runtime/pid.ts";

const HOME_DIR = join(homedir(), ".misanthropic");
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
		stop();
		break;
	case "restart":
		stop();
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
		console.log("Usage: ma <start|stop|restart|status|tui|dev>");
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

	// Wait briefly to confirm it started
	setTimeout(() => {
		if (pid.isRunning()) {
			console.log(`Daemon started (pid ${child.pid})`);
			console.log(`Log: ${LOG_PATH}`);
		} else {
			console.log("Daemon failed to start. Check logs:");
			console.log(`  cat ${LOG_PATH}`);
			process.exit(1);
		}
		process.exit(0);
	}, 500);
}

function stop() {
	const runningPid = pid.read();
	if (!runningPid || !pid.isRunning()) {
		console.log("Daemon is not running");
		pid.remove();
		return;
	}

	process.kill(runningPid, "SIGTERM");
	pid.remove();
	console.log(`Daemon stopped (pid ${runningPid})`);
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
			`Daemon already running (pid ${pid.read()}). Stop it first: ma stop`,
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
		console.log("Daemon is not running. Start it first: ma start");
		process.exit(1);
	}

	// Run TUI in foreground
	Bun.spawnSync(["bun", TUI_ENTRY], {
		stdio: ["inherit", "inherit", "inherit"],
		env: { ...process.env },
	});
}
