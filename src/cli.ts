#!/usr/bin/env bun
import { agentCommand } from "./cli/agent.ts";
import { configCommand } from "./cli/config.ts";
import { cronCommand } from "./cli/cron.ts";
import { createDaemonCommands } from "./cli/daemon.ts";
import { noteCommand } from "./cli/note.ts";
import { onboardCommand } from "./cli/onboard.ts";
import { schemaCommand } from "./cli/schema.ts";
import { sessionCommand } from "./cli/session.ts";
import {
	isHelpFlag,
	printOnboardUsage,
	printStartUsage,
	printUsage,
} from "./cli/usage.ts";
import { createOutclawLayout } from "./common/layout.ts";

const layout = createOutclawLayout({ srcRoot: import.meta.dir });
const argv = process.argv;
const daemon = createDaemonCommands({
	argv,
	browserDir: layout.browserDir,
	daemonEntry: layout.daemonEntry,
	homeDir: layout.homeDir,
	logPath: layout.logPath,
	pidPath: layout.pidPath,
	readyPath: layout.readyPath,
	templatesDir: layout.templatesDir,
	tuiEntry: layout.tuiEntry,
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
	case "onboard":
		if (isHelpFlag(argv[3])) {
			printOnboardUsage();
			process.exit(0);
		}
		await onboardCommand({
			cliEntry: layout.cliEntry,
			homeDir: layout.homeDir,
			templatesDir: layout.templatesDir,
		});
		break;
	case "agent":
		await agentCommand({
			argv,
			homeDir: layout.homeDir,
			templatesDir: layout.templatesDir,
			tui: daemon.tui,
		});
		break;
	case "config":
		configCommand({
			argv,
			homeDir: layout.homeDir,
		});
		break;
	case "session":
		await sessionCommand(argv);
		break;
	case "cron":
		await cronCommand({
			argv,
			homeDir: layout.homeDir,
		});
		break;
	case "note":
		await noteCommand({ argv });
		break;
	case "schema":
		await schemaCommand({
			argv,
			homeDir: layout.homeDir,
		});
		break;
	case "dev":
		daemon.dev();
		break;
	default:
		printUsage();
		process.exit(1);
}
