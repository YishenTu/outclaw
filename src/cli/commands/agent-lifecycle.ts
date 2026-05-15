import { ClaudeAdapter } from "../../backend/adapters/claude/index.ts";
import { ensureCodexAgentWorkspace } from "../../backend/adapters/codex/setup.ts";
import { createAgent } from "../../runtime/agents/create-agent.ts";
import { ensureGlobalEnvFile } from "../../runtime/agents/ensure-global-env-file.ts";
import { listAgents } from "../../runtime/agents/list-agents.ts";
import { removeAgent } from "../../runtime/agents/remove-agent.ts";
import { renameAgent } from "../../runtime/agents/rename-agent.ts";
import { updateAgent } from "../../runtime/agents/update-agent.ts";
import { parseFlagValues } from "../support/argv.ts";
import { maybeMarkRestartRequired } from "../support/restart-required.ts";
import {
	formatAgentConfigUsage,
	formatAgentCreateUsage,
	formatAgentRemoveUsage,
	formatAgentRenameUsage,
	hasHelpFlag,
	printAgentConfigUsage,
	printAgentCreateUsage,
	printAgentListUsage,
	printAgentRemoveUsage,
	printAgentRenameUsage,
} from "../support/usage.ts";

interface AgentLifecycleCommandOptions {
	argv: string[];
	homeDir: string;
	templatesDir: string;
}

const claudeWorkspaceAdapter = new ClaudeAdapter();

export function printAgentListCommand(homeDir: string, argv: string[]) {
	if (hasHelpFlag(argv.slice(4))) {
		printAgentListUsage();
		process.exit(0);
	}

	const agents = listAgents(homeDir);
	if (agents.length === 0) {
		console.log("No agents");
		return;
	}

	for (const agent of agents) {
		console.log(agent.name);
	}
}

export function createAgentCommand(options: AgentLifecycleCommandOptions) {
	if (hasHelpFlag(options.argv.slice(4))) {
		printAgentCreateUsage();
		process.exit(0);
	}
	const name = options.argv[4];
	if (!name) {
		console.error(formatAgentCreateUsage());
		process.exit(1);
	}

	const flags = parseFlagValues(options.argv.slice(5));
	const created = createAgent({
		allowedUsers: parseUsers(flags.users),
		botToken: flags["bot-token"] ?? "",
		defaultCronUserId:
			flags["default-cron-user"] !== undefined
				? parseDefaultCronUser(flags["default-cron-user"])
				: undefined,
		homeDir: options.homeDir,
		name,
		prepareWorkspace: (agentHomeDir) => {
			claudeWorkspaceAdapter.prepareWorkspace(agentHomeDir);
			// `oc agent create` must materialize the Codex provider view
			// alongside the Claude one — the daemon's per-agent
			// codexAdapter.prepareWorkspace() handles existing agents on
			// boot, but a brand-new agent created from the CLI between
			// daemon restarts would otherwise be missing the Codex layer.
			ensureCodexAgentWorkspace(agentHomeDir);
		},
		rolloverIdleMinutes:
			flags["rollover-idle"] !== undefined
				? parseRolloverIdleMinutes(flags["rollover-idle"])
				: undefined,
		templatesDir: options.templatesDir,
	});
	ensureGlobalEnvFile(options.homeDir);
	console.log(`Created agent ${name}`);
	console.log(created.agentHomeDir);
	maybeMarkRestartRequired(options.homeDir);
}

export function renameAgentCommand(homeDir: string, argv: string[]) {
	if (hasHelpFlag(argv.slice(4))) {
		printAgentRenameUsage();
		process.exit(0);
	}
	const oldName = argv[4];
	const newName = argv[5];
	if (!oldName || !newName) {
		console.error(formatAgentRenameUsage());
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

export function configAgentCommand(homeDir: string, argv: string[]) {
	if (hasHelpFlag(argv.slice(4))) {
		printAgentConfigUsage();
		process.exit(0);
	}
	const name = argv[4];
	if (!name) {
		console.error(formatAgentConfigUsage());
		process.exit(1);
	}

	const flags = parseFlagValues(argv.slice(5));
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
		rolloverIdleMinutes:
			flags["rollover-idle"] !== undefined
				? parseRolloverIdleMinutes(flags["rollover-idle"])
				: undefined,
	});
	console.log(`Configured agent ${name}`);
	maybeMarkRestartRequired(homeDir);
}

export function removeAgentCommand(homeDir: string, argv: string[]) {
	if (hasHelpFlag(argv.slice(4))) {
		printAgentRemoveUsage();
		process.exit(0);
	}
	const name = argv[4];
	if (!name) {
		console.error(formatAgentRemoveUsage());
		process.exit(1);
	}

	removeAgent({ homeDir, name });
	console.log(`Removed agent ${name}`);
	maybeMarkRestartRequired(homeDir);
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

function parseRolloverIdleMinutes(value: string | undefined): number {
	if (value === undefined || value === "" || !/^\d+$/.test(value)) {
		console.error(`Invalid rollover idle minutes: ${value ?? ""}`);
		process.exit(1);
	}
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) {
		console.error(`Invalid rollover idle minutes: ${value}`);
		process.exit(1);
	}
	return parsed;
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
