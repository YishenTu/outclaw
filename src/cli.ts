#!/usr/bin/env bun
import { homedir } from "node:os";
import { join } from "node:path";
import { agentCommand } from "./cli/agent.ts";
import { configCommand } from "./cli/config.ts";
import { createDaemonCommands } from "./cli/daemon.ts";
import { sessionCommand } from "./cli/session.ts";
import { isHelpFlag, printStartUsage, printUsage } from "./cli/usage.ts";

const HOME_DIR = join(homedir(), ".outclaw");
const PID_PATH = join(HOME_DIR, "daemon.pid");
const LOG_PATH = join(HOME_DIR, "daemon.log");
const READY_PATH = join(HOME_DIR, "daemon.ready");
const DAEMON_ENTRY = join(import.meta.dir, "index.ts");
const TEMPLATES_DIR = join(import.meta.dir, "templates");
const TUI_ENTRY = join(import.meta.dir, "tui.ts");
const BROWSER_DIR = join(import.meta.dir, "frontend", "browser");
const argv = process.argv;
const daemon = createDaemonCommands({
	argv,
	browserDir: BROWSER_DIR,
	daemonEntry: DAEMON_ENTRY,
	homeDir: HOME_DIR,
	logPath: LOG_PATH,
	pidPath: PID_PATH,
	readyPath: READY_PATH,
	templatesDir: TEMPLATES_DIR,
	tuiEntry: TUI_ENTRY,
});
const command = argv[2];

if (command === "-h" || command === "--help" || command === "help") {
	printUsage();
	process.exit(0);
}

switch (command) {
	case "build":
		daemon.build();
		break;
	case "start":
		if (isHelpFlag(argv[3])) {
			printStartUsage();
			process.exit(0);
		}
		await daemon.start();
		break;
	case "stop":
		await daemon.stop();
		break;
	case "restart":
		if (isHelpFlag(argv[3])) {
			printStartUsage();
			process.exit(0);
		}
		await daemon.restart();
		break;
	case "status":
		daemon.status();
		break;
	case "tui":
		daemon.tui();
		break;
	case "browser":
		daemon.browser();
		break;
	case "agent":
		await agentCommand({
			argv,
			homeDir: HOME_DIR,
			templatesDir: TEMPLATES_DIR,
			tui: daemon.tui,
		});
		break;
	case "config":
		configCommand({
			argv,
			homeDir: HOME_DIR,
		});
		break;
	case "session":
		await sessionCommand(argv);
		break;
	case "dev":
		daemon.dev();
		break;
	default:
		printUsage();
		process.exit(1);
}
