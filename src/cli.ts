#!/usr/bin/env bun
import { createDaemonCommands } from "./cli/commands/daemon.ts";
import { onboardCommand } from "./cli/commands/onboard.ts";
import {
	isHelpFlag,
	printOnboardUsage,
	printStartUsage,
	printUsage,
} from "./cli/support/usage.ts";
import { createOutclawLayout } from "./common/layout.ts";

const layout = createOutclawLayout({ srcRoot: import.meta.dir });
const argv = process.argv;
const daemon = createDaemonCommands({
	argv,
	browserDir: layout.browserDir,
	cliEntry: layout.cliEntry,
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
	case "dev":
		daemon.dev();
		break;
	default:
		printUsage();
		process.exit(1);
}
