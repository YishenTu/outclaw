import { existsSync } from "node:fs";
import { createOutclawLayout } from "../../common/layout.ts";
import { listAgents } from "../../runtime/agents/list-agents.ts";
import { loadGlobalConfig } from "../../runtime/config/index.ts";
import { SessionQuery } from "../../runtime/persistence/session-query.ts";
import { requestControlMessage } from "../support/control-client.ts";
import {
	formatFailedCronJson,
	formatFailedCronNames,
	formatFailedCronStatus,
} from "../support/cron-status-read-model.ts";
import { resolveScopedAgent } from "../support/session-read-model.ts";
import {
	formatCronRunUsage,
	formatCronStatusUsage,
	hasHelpFlag,
	isHelpFlag,
	printCronRunUsage,
	printCronStatusUsage,
	printCronUsage,
} from "../support/usage.ts";

interface CronCommandOptions {
	argv: string[];
	homeDir: string;
}

interface CronStatusOptions {
	jobName?: string;
	json: boolean;
	limit?: number;
	names: boolean;
	since?: number;
}

const DEFAULT_CRON_STATUS_SINCE_MS = 7 * 24 * 60 * 60 * 1000;

export async function cronCommand(options: CronCommandOptions) {
	const subcommand = options.argv[3];
	if (subcommand === undefined || isHelpFlag(subcommand)) {
		printCronUsage();
		process.exit(subcommand === undefined ? 1 : 0);
	}

	switch (subcommand) {
		case "run":
			await runCronCommand(options.homeDir, options.argv);
			return;
		case "status":
			statusCronCommand(options.homeDir, options.argv);
			return;
		default:
			printCronUsage();
			process.exit(1);
	}
}

function statusCronCommand(homeDir: string, argv: string[]) {
	const args = argv.slice(4);
	if (hasHelpFlag(args)) {
		printCronStatusUsage();
		process.exit(0);
	}

	const options = parseCronStatusOptions(args);
	const layout = createOutclawLayout({ homeDir });
	const agents = listAgents(homeDir);
	const scopedAgent = resolveScopedAgent(agents, process.cwd());

	if (!existsSync(layout.dbPath)) {
		printEmptyCronStatus(options);
		return;
	}

	const query = new SessionQuery(layout.dbPath);
	try {
		const sessions = query.listFailedCronRuns({
			agentId: scopedAgent?.agentId,
			jobName: options.jobName,
			limit: options.limit,
			since: options.since,
		});
		if (sessions.length === 0) {
			printEmptyCronStatus(options);
			return;
		}

		if (options.names) {
			console.log(formatFailedCronNames(sessions));
			return;
		}
		if (options.json) {
			console.log(formatFailedCronJson(sessions, agents));
			return;
		}
		console.log(formatFailedCronStatus(sessions, agents));
	} finally {
		query.close();
	}
}

function parseCronStatusOptions(args: string[]): CronStatusOptions {
	let failed = false;
	let jobName: string | undefined;
	let json = false;
	let limit: number | undefined;
	let names = false;
	let since: number | undefined;
	let sinceProvided = false;

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (!arg?.startsWith("--")) {
			console.error(`Unexpected cron status argument: ${arg ?? ""}`);
			process.exit(1);
		}

		switch (arg) {
			case "--failed":
				assertBooleanFlagHasNoValue(args, index, arg);
				failed = true;
				break;
			case "--json":
				assertBooleanFlagHasNoValue(args, index, arg);
				json = true;
				break;
			case "--names":
				assertBooleanFlagHasNoValue(args, index, arg);
				names = true;
				break;
			case "--job":
				jobName = readFlagValue(args, index, arg);
				index += 1;
				break;
			case "--limit":
				limit = parsePositiveInteger(readFlagValue(args, index, arg), arg);
				index += 1;
				break;
			case "--since":
				since = parseSince(readFlagValue(args, index, arg));
				sinceProvided = true;
				index += 1;
				break;
			default:
				console.error(`Unsupported cron status flag: ${arg}`);
				process.exit(1);
		}
	}

	if (!failed) {
		console.error(formatCronStatusUsage());
		process.exit(1);
	}

	if (names && json) {
		console.error("--names and --json cannot be combined");
		process.exit(1);
	}

	return {
		jobName,
		json,
		limit,
		names,
		since: sinceProvided ? since : parseSince(undefined),
	};
}

function readFlagValue(
	args: string[],
	index: number,
	flagName: string,
): string {
	const value = args[index + 1];
	if (!value || value.startsWith("--")) {
		console.error(`Missing value for ${flagName}`);
		process.exit(1);
	}
	return value;
}

function assertBooleanFlagHasNoValue(
	args: string[],
	index: number,
	flagName: string,
) {
	const value = args[index + 1];
	if (value && !value.startsWith("--")) {
		console.error(`Unexpected value for ${flagName}: ${value}`);
		process.exit(1);
	}
}

function parsePositiveInteger(
	value: string | undefined,
	flagName: string,
): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== value) {
		console.error(`Invalid ${flagName} value: ${value}`);
		process.exit(1);
	}
	return parsed;
}

function parseSince(value: string | undefined): number | undefined {
	if (value === undefined) {
		return Date.now() - DEFAULT_CRON_STATUS_SINCE_MS;
	}
	if (value === "all") {
		return undefined;
	}

	const duration = parseDurationMs(value);
	if (duration !== undefined) {
		return Date.now() - duration;
	}

	const timestamp = Date.parse(value);
	if (Number.isNaN(timestamp)) {
		console.error(`Invalid --since value: ${value}`);
		process.exit(1);
	}
	return timestamp;
}

function parseDurationMs(value: string): number | undefined {
	const match = /^(\d+)([mhdw])$/.exec(value);
	if (!match) {
		return undefined;
	}

	const amount = Number.parseInt(match[1] ?? "", 10);
	if (!Number.isInteger(amount) || amount <= 0) {
		return undefined;
	}

	const unit = match[2];
	const minute = 60 * 1000;
	if (unit === "m") return amount * minute;
	if (unit === "h") return amount * 60 * minute;
	if (unit === "d") return amount * 24 * 60 * minute;
	return amount * 7 * 24 * 60 * minute;
}

function printEmptyCronStatus(options: CronStatusOptions) {
	if (options.names) {
		return;
	}
	if (options.json) {
		console.log("[]");
		return;
	}
	console.log("No failed cron runs");
}

async function runCronCommand(homeDir: string, argv: string[]) {
	const args = argv.slice(4);
	if (hasHelpFlag(args)) {
		printCronRunUsage();
		process.exit(0);
	}

	const jobName = args[0];
	if (!jobName || jobName.startsWith("--") || args.length !== 1) {
		console.error(formatCronRunUsage());
		process.exit(1);
	}

	const config = loadGlobalConfig(homeDir);
	try {
		await requestCronRun({
			cwd: process.cwd(),
			jobName,
			port: config.port,
		});
		process.exit(0);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(message);
		process.exit(1);
	}
}

async function requestCronRun(params: {
	cwd: string;
	jobName: string;
	port: number;
}): Promise<void> {
	await requestControlMessage({
		closeBeforeResponseMessage: "cron run connection closed before response",
		errorFallback: "cron run failed",
		errorType: "cron_run_error",
		port: params.port,
		request: {
			type: "cron_run",
			cwd: params.cwd,
			jobName: params.jobName,
		},
		responseType: "cron_run_response",
		toResult: () => undefined,
	});
}
