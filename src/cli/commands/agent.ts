import { isHelpFlag, printAgentUsage } from "../support/usage.ts";
import { askAgentCommand } from "./agent-ask.ts";
import {
	configAgentCommand,
	createAgentCommand,
	printAgentListCommand,
	removeAgentCommand,
	renameAgentCommand,
} from "./agent-lifecycle.ts";
import { sendAgentCommand } from "./agent-send.ts";

interface AgentCommandOptions {
	argv: string[];
	homeDir: string;
	templatesDir: string;
	tui: (explicitAgentName?: string) => void;
}

export async function agentCommand(options: AgentCommandOptions) {
	const subcommand = options.argv[3];
	if (subcommand === undefined || isHelpFlag(subcommand)) {
		printAgentUsage();
		process.exit(subcommand === undefined ? 1 : 0);
		return;
	}

	switch (subcommand) {
		case "list":
			printAgentListCommand(options.homeDir, options.argv);
			return;
		case "create":
			createAgentCommand(options);
			return;
		case "rename":
			renameAgentCommand(options.homeDir, options.argv);
			return;
		case "remove":
			removeAgentCommand(options.homeDir, options.argv);
			return;
		case "config":
			configAgentCommand(options.homeDir, options.argv);
			return;
		case "ask":
			await askAgentCommand(options.homeDir, options.argv);
			return;
		case "send":
			await sendAgentCommand(options.homeDir, options.argv);
			return;
		default:
			options.tui(subcommand);
	}
}
