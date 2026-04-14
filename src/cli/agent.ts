import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createAgent } from "../runtime/agents/create-agent.ts";
import { listAgents } from "../runtime/agents/list-agents.ts";
import { removeAgent } from "../runtime/agents/remove-agent.ts";
import { renameAgent } from "../runtime/agents/rename-agent.ts";
import { updateAgent } from "../runtime/agents/update-agent.ts";

interface AgentCommandOptions {
	argv: string[];
	homeDir: string;
	printUsage: () => void;
	templatesDir: string;
	tui: (explicitAgentName?: string) => void;
}

export async function agentCommand(options: AgentCommandOptions) {
	const subcommand = options.argv[3];
	switch (subcommand) {
		case "list":
			printAgentList(options.homeDir);
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
		case undefined:
			options.printUsage();
			process.exit(1);
			return;
		default:
			options.tui(subcommand);
	}
}

function printAgentList(homeDir: string) {
	const agents = listAgents(homeDir);
	if (agents.length === 0) {
		console.log("No agents");
		return;
	}

	for (const agent of agents) {
		console.log(agent.name);
	}
}

function createAgentCommand(options: AgentCommandOptions) {
	const name = options.argv[4];
	if (!name) {
		console.log(
			"Usage: oc agent create <name> [--bot-token <token>] [--users <ids>]",
		);
		process.exit(1);
	}

	const flags = parseFlags(options.argv.slice(5));
	const created = createAgent({
		allowedUsers: parseUsers(flags.users),
		botToken: flags["bot-token"] ?? "",
		homeDir: options.homeDir,
		name,
		templatesDir: options.templatesDir,
	});
	ensureEnvFile(options.homeDir);
	console.log(`Created agent ${name}`);
	console.log(created.agentHomeDir);
}

function renameAgentCommand(homeDir: string, argv: string[]) {
	const oldName = argv[4];
	const newName = argv[5];
	if (!oldName || !newName) {
		console.log("Usage: oc agent rename <old-name> <new-name>");
		process.exit(1);
	}

	renameAgent({
		homeDir,
		newName,
		oldName,
	});
	console.log(`Renamed agent ${oldName} -> ${newName}`);
}

function configAgentCommand(homeDir: string, argv: string[]) {
	const name = argv[4];
	if (!name) {
		console.log(
			"Usage: oc agent config <name> [--bot-token <token>] [--users <ids>]",
		);
		process.exit(1);
	}

	const flags = parseFlags(argv.slice(5));
	updateAgent({
		homeDir,
		name,
		botToken: flags["bot-token"],
		allowedUsers:
			flags.users !== undefined ? parseUsers(flags.users) : undefined,
	});
	console.log(`Configured agent ${name}`);
}

function removeAgentCommand(homeDir: string, argv: string[]) {
	const name = argv[4];
	if (!name) {
		console.log("Usage: oc agent remove <name>");
		process.exit(1);
	}

	removeAgent({ homeDir, name });
	console.log(`Removed agent ${name}`);
}

function ensureEnvFile(homeDir: string) {
	const envPath = join(homeDir, ".env");
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
	if (value === undefined) {
		return [];
	}

	const entries = value.split(",").map((item) => item.trim());
	if (entries.length === 0 || entries.some((item) => !/^-?\d+$/.test(item))) {
		console.error(`Invalid users: ${value}`);
		process.exit(1);
	}

	return entries.map((item) => Number(item));
}
