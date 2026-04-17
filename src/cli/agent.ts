import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prepareAgentWorkspace } from "../backend/agent-workspace.ts";
import { createAgent } from "../runtime/agents/create-agent.ts";
import { listAgents } from "../runtime/agents/list-agents.ts";
import { removeAgent } from "../runtime/agents/remove-agent.ts";
import { renameAgent } from "../runtime/agents/rename-agent.ts";
import { updateAgent } from "../runtime/agents/update-agent.ts";
import { loadGlobalConfig } from "../runtime/config.ts";
import { SessionStore } from "../runtime/persistence/session-store.ts";
import { PidManager } from "../runtime/process/pid-manager.ts";

interface AgentCommandOptions {
	argv: string[];
	homeDir: string;
	printUsage: () => void;
	templatesDir: string;
	tui: (explicitAgentName?: string) => void;
}

const RESTART_REQUIRED_MESSAGE =
	"Restart required. Agent changes won't update until the runtime restarts.";

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
	const parsed = parseAskArgs(args);
	const target = parsed.target;
	const timeoutSeconds = parsed.timeoutSeconds;
	const message = parsed.message;
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
	try {
		const text = await requestAgentResponse({
			message,
			port: config.port,
			senderAgentId: sender.agentId,
			target,
			timeoutSeconds,
		});
		console.log(text);
		process.exit(0);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.startsWith("TIMEOUT:")) {
			console.error(message.slice("TIMEOUT:".length));
			process.exit(124);
		}
		console.error(message);
		process.exit(1);
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
			"Usage: oc agent create <name> [--bot-token <token>] [--users <ids>] [--default-cron-user <id>]",
		);
		process.exit(1);
	}

	const flags = parseFlags(options.argv.slice(5));
	const created = createAgent({
		allowedUsers: parseUsers(flags.users),
		botToken: flags["bot-token"] ?? "",
		defaultCronUserId:
			flags["default-cron-user"] !== undefined
				? parseDefaultCronUser(flags["default-cron-user"])
				: undefined,
		homeDir: options.homeDir,
		name,
		prepareWorkspace: prepareAgentWorkspace,
		templatesDir: options.templatesDir,
	});
	ensureEnvFile(options.homeDir);
	console.log(`Created agent ${name}`);
	console.log(created.agentHomeDir);
	maybeMarkRestartRequired(options.homeDir);
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
	maybeMarkRestartRequired(homeDir);
}

function configAgentCommand(homeDir: string, argv: string[]) {
	const name = argv[4];
	if (!name) {
		console.log(
			"Usage: oc agent config <name> [--bot-token <token>] [--users <ids>] [--default-cron-user <id>]",
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
		defaultCronUserId:
			flags["default-cron-user"] !== undefined
				? parseDefaultCronUser(flags["default-cron-user"])
				: undefined,
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
	maybeMarkRestartRequired(homeDir);
}

function ensureEnvFile(homeDir: string) {
	const envPath = join(homeDir, ".env");
	if (!existsSync(envPath)) {
		writeFileSync(envPath, "");
	}
}

function maybeMarkRestartRequired(homeDir: string) {
	const pid = new PidManager(join(homeDir, "daemon.pid"));
	if (!pid.isRunning()) {
		return;
	}

	const store = new SessionStore(join(homeDir, "db.sqlite"));
	try {
		store.setFrontendNotice({ kind: "restart_required" });
	} finally {
		store.close();
	}

	console.log(RESTART_REQUIRED_MESSAGE);
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

function parseTimeoutSeconds(value: string | undefined): number | undefined {
	if (value === undefined || value === "") {
		return undefined;
	}
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		console.error(`Invalid timeout: ${value}`);
		process.exit(1);
	}
	return parsed;
}

function parseDefaultCronUser(value: string | undefined): number {
	if (value === undefined || value === "" || !/^\d+$/.test(value)) {
		console.error(`Invalid default cron user: ${value ?? ""}`);
		process.exit(1);
	}
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		console.error(`Invalid default cron user: ${value}`);
		process.exit(1);
	}
	return parsed;
}

export function parseAskArgs(args: string[]): {
	message?: string;
	target?: string;
	timeoutSeconds?: number;
} {
	let target: string | undefined;
	let timeoutValue: string | undefined;
	let parseFlags = true;
	const messageParts: string[] = [];
	let valid = true;

	for (let index = 0; index < args.length; index += 1) {
		const value = args[index];
		if (!value) {
			continue;
		}
		if (parseFlags && value === "--") {
			parseFlags = false;
			continue;
		}
		if (parseFlags && value === "--to") {
			const nextValue = args[index + 1];
			if (!nextValue || nextValue.startsWith("--")) {
				valid = false;
				break;
			}
			target = nextValue;
			index += 1;
			continue;
		}
		if (parseFlags && value === "--timeout") {
			const nextValue = args[index + 1];
			if (!nextValue || nextValue.startsWith("--")) {
				valid = false;
				break;
			}
			timeoutValue = nextValue;
			index += 1;
			continue;
		}
		if (parseFlags && value.startsWith("--")) {
			valid = false;
			break;
		}
		messageParts.push(value);
	}

	return {
		message:
			valid && messageParts.length > 0 ? messageParts.join(" ") : undefined,
		target: valid ? target : undefined,
		timeoutSeconds: parseTimeoutSeconds(timeoutValue),
	};
}

async function requestAgentResponse(params: {
	message: string;
	port: number;
	senderAgentId: string;
	target: string;
	timeoutSeconds?: number;
}): Promise<string> {
	const ws = new WebSocket(`ws://localhost:${params.port}/?client=control`);

	return new Promise<string>((resolve, reject) => {
		let settled = false;
		let opened = false;
		let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

		const finish = (fn: () => void) => {
			if (settled) {
				return;
			}
			settled = true;
			if (timeoutHandle !== undefined) {
				clearTimeout(timeoutHandle);
			}
			fn();
		};

		if (params.timeoutSeconds !== undefined) {
			timeoutHandle = setTimeout(() => {
				finish(() =>
					reject(
						new Error(
							`TIMEOUT:agent ask timed out after ${params.timeoutSeconds}s`,
						),
					),
				);
				ws.close();
			}, params.timeoutSeconds * 1000);
		}

		ws.addEventListener("open", () => {
			opened = true;
			ws.send(
				JSON.stringify({
					type: "ask",
					fromAgentId: params.senderAgentId,
					to: params.target,
					message: params.message,
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
				const text = data.text ?? "";
				finish(() => resolve(text));
				ws.close();
				return;
			}
			if (data.type === "ask_error") {
				finish(() => reject(new Error(data.message ?? "agent ask failed")));
				ws.close();
			}
		});

		ws.addEventListener("error", () => {
			finish(() => reject(new Error("daemon not running")));
		});

		ws.addEventListener("close", () => {
			if (settled) {
				return;
			}
			finish(() =>
				reject(
					new Error(
						opened
							? "agent ask connection closed before response"
							: "daemon not running",
					),
				),
			);
		});
	});
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
