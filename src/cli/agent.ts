import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createAgent } from "../runtime/agents/create-agent.ts";
import { listAgents } from "../runtime/agents/list-agents.ts";
import { removeAgent } from "../runtime/agents/remove-agent.ts";
import { renameAgent } from "../runtime/agents/rename-agent.ts";
import { updateAgent } from "../runtime/agents/update-agent.ts";
import { loadGlobalConfig } from "../runtime/config.ts";

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
		case "ask":
			await askAgentCommand(options.homeDir, options.argv);
			return;
		case undefined:
			options.printUsage();
			process.exit(1);
			return;
		default:
			options.tui(subcommand);
	}
}

async function askAgentCommand(homeDir: string, argv: string[]) {
	const args = argv.slice(4);
	const flags = parseFlags(args);
	const target = flags.to;
	const timeoutSeconds = parseTimeoutSeconds(flags.timeout);
	const message = args.filter((value) => !value.startsWith("--")).at(-1);
	if (!target || !message) {
		console.error(
			'Usage: oc agent ask --to <target> [--timeout <seconds>] "<message>"',
		);
		process.exit(1);
	}

	const sender = resolveSenderAgent(homeDir, process.cwd());
	if (!sender) {
		console.error("cannot resolve sender agent from cwd");
		process.exit(1);
	}

	const config = loadGlobalConfig(homeDir);
	const ws = new WebSocket(`ws://localhost:${config.port}/?client=control`);
	const timeoutHandle = setTimeout(() => {
		ws.close();
		console.error(`agent ask timed out after ${timeoutSeconds}s`);
		process.exit(124);
	}, timeoutSeconds * 1000);

	await new Promise<void>((resolve) => {
		ws.addEventListener("open", () => {
			ws.send(
				JSON.stringify({
					type: "ask",
					fromAgentId: sender.agentId,
					to: target,
					message,
				}),
			);
		});
		ws.addEventListener("message", (event) => {
			const data = JSON.parse(String(event.data)) as {
				type: string;
				message?: string;
				text?: string;
			};
			if (data.type === "ask_response") {
				clearTimeout(timeoutHandle);
				console.log(data.text ?? "");
				ws.close();
				resolve();
				return;
			}
			if (data.type === "ask_error") {
				clearTimeout(timeoutHandle);
				console.error(data.message ?? "agent ask failed");
				ws.close();
				process.exit(1);
			}
		});
		ws.addEventListener("error", () => {
			clearTimeout(timeoutHandle);
			console.error("daemon not running");
			process.exit(1);
		});
		ws.addEventListener("close", () => {
			clearTimeout(timeoutHandle);
		});
	});
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

function parseTimeoutSeconds(value: string | undefined): number {
	if (value === undefined || value === "") {
		return 300;
	}
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		console.error(`Invalid timeout: ${value}`);
		process.exit(1);
	}
	return parsed;
}

function resolveSenderAgent(
	homeDir: string,
	cwd: string,
): { agentId: string; name: string } | undefined {
	const agentIdPath = join(cwd, ".agent-id");
	if (!existsSync(agentIdPath)) {
		return undefined;
	}
	const agentId = readFileSync(agentIdPath, "utf-8").trim();
	if (!agentId) {
		return undefined;
	}
	return listAgents(homeDir).find((agent) => agent.agentId === agentId);
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
