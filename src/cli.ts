#!/usr/bin/env bun
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { createAgent } from "./runtime/agents/create-agent.ts";
import { listAgents } from "./runtime/agents/list-agents.ts";
import { onboardFirstAgent } from "./runtime/agents/onboard-first-agent.ts";
import { removeAgent } from "./runtime/agents/remove-agent.ts";
import { renameAgent } from "./runtime/agents/rename-agent.ts";
import { secureAgentConfig } from "./runtime/config/secure-agent-config.ts";
import { stopDaemon } from "./runtime/process/daemon-stop.ts";
import { PidManager } from "./runtime/process/pid-manager.ts";

const HOME_DIR = join(homedir(), ".outclaw");
const PID_PATH = join(HOME_DIR, "daemon.pid");
const LOG_PATH = join(HOME_DIR, "daemon.log");
const DAEMON_ENTRY = join(import.meta.dir, "index.ts");
const TEMPLATES_DIR = join(import.meta.dir, "templates");
const TUI_ENTRY = join(import.meta.dir, "tui.ts");

const pid = new PidManager(PID_PATH);
const command = process.argv[2];

switch (command) {
	case "start":
		await start();
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
	case "agent":
		await agent();
		break;
	case "config":
		config();
		break;
	case "dev":
		dev();
		break;
	default:
		printUsage();
		process.exit(1);
}

async function start() {
	mkdirSync(HOME_DIR, { recursive: true });

	if (pid.isRunning()) {
		console.log(`Daemon already running (pid ${pid.read()})`);
		process.exit(1);
	}

	if (listAgents(HOME_DIR).length === 0) {
		await runFreshInstallOnboarding();
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

function tui(explicitAgentName?: string) {
	if (!pid.isRunning()) {
		console.log("Daemon is not running. Start it first: oc start");
		process.exit(1);
	}

	const watch = process.argv.includes("--watch");
	const extraArgs = process.argv
		.slice(explicitAgentName ? 4 : 3)
		.filter((argument) => argument !== "--watch");
	if (explicitAgentName) {
		extraArgs.unshift(explicitAgentName);
		extraArgs.unshift("--agent");
	}
	const args = watch
		? ["bun", "--watch", TUI_ENTRY, ...extraArgs]
		: ["bun", TUI_ENTRY, ...extraArgs];
	Bun.spawnSync(args, {
		stdio: ["inherit", "inherit", "inherit"],
		env: { ...process.env },
	});
}

async function agent() {
	const subcommand = process.argv[3];
	switch (subcommand) {
		case "list":
			printAgentList();
			return;
		case "create":
			createAgentCommand();
			return;
		case "rename":
			renameAgentCommand();
			return;
		case "remove":
			removeAgentCommand();
			return;
		case undefined:
			printUsage();
			process.exit(1);
			return;
		default:
			tui(subcommand);
	}
}

function config() {
	const subcommand = process.argv[3];
	switch (subcommand) {
		case "secure":
			configSecureCommand();
			return;
		default:
			printUsage();
			process.exit(1);
	}
}

function printAgentList() {
	const agents = listAgents(HOME_DIR);
	if (agents.length === 0) {
		console.log("No agents");
		return;
	}

	for (const agent of agents) {
		console.log(agent.name);
	}
}

function createAgentCommand() {
	const name = process.argv[4];
	if (!name) {
		console.log(
			"Usage: oc agent create <name> [--bot-token <token>] [--users <ids>]",
		);
		process.exit(1);
	}

	const flags = parseFlags(process.argv.slice(5));
	const created = createAgent({
		allowedUsers: parseUsers(flags.users),
		botToken: flags["bot-token"] ?? "",
		homeDir: HOME_DIR,
		name,
		templatesDir: TEMPLATES_DIR,
	});
	ensureEnvFile();
	console.log(`Created agent ${name}`);
	console.log(created.agentHomeDir);
}

function renameAgentCommand() {
	const oldName = process.argv[4];
	const newName = process.argv[5];
	if (!oldName || !newName) {
		console.log("Usage: oc agent rename <old-name> <new-name>");
		process.exit(1);
	}

	renameAgent({
		homeDir: HOME_DIR,
		newName,
		oldName,
	});
	console.log(`Renamed agent ${oldName} -> ${newName}`);
}

function removeAgentCommand() {
	const name = process.argv[4];
	if (!name) {
		console.log("Usage: oc agent remove <name>");
		process.exit(1);
	}

	removeAgent({ homeDir: HOME_DIR, name });
	console.log(`Removed agent ${name}`);
}

function configSecureCommand() {
	const result = secureAgentConfig(HOME_DIR);
	if (result.changes.length === 0) {
		console.log("No hardcoded agent telegram config found in config.json");
		return;
	}

	for (const change of result.changes) {
		console.log(`config.json: ${change.path} -> $${change.envKey}`);
	}
	console.log("Updated .env");
}

function ensureEnvFile() {
	const envPath = join(HOME_DIR, ".env");
	if (!existsSync(envPath)) {
		writeFileSync(envPath, "");
	}
}

function parseFlags(args: string[]) {
	const flags: Record<string, string> = {};
	for (let index = 0; index < args.length; index += 1) {
		const key = args[index];
		if (!key?.startsWith("--")) {
			continue;
		}
		const value = args[index + 1];
		if (value && !value.startsWith("--")) {
			flags[key.slice(2)] = value;
			index += 1;
			continue;
		}
		flags[key.slice(2)] = "";
	}
	return flags;
}

function parseUsers(value: string | undefined) {
	if (!value) {
		return [];
	}

	return value
		.split(",")
		.map((item) => Number(item.trim()))
		.filter((item) => Number.isInteger(item));
}

function printUsage() {
	console.log(
		"Usage: oc <start|stop|restart|status|tui|dev|agent|config>\n" +
			"       oc agent <list|create|rename|remove|name>\n" +
			"       oc config secure",
	);
}

async function runFreshInstallOnboarding() {
	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	try {
		await onboardFirstAgent({
			homeDir: HOME_DIR,
			io: {
				log: (message) => console.log(`\n${message}\n`),
				prompt: (message) => rl.question(message),
			},
			templatesDir: TEMPLATES_DIR,
		});
	} finally {
		rl.close();
	}
}
