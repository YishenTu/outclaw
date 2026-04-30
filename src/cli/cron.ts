import { loadGlobalConfig } from "../runtime/config.ts";
import { requestControlMessage } from "./control-client.ts";
import {
	formatCronRunUsage,
	hasHelpFlag,
	isHelpFlag,
	printCronRunUsage,
	printCronUsage,
} from "./usage.ts";

interface CronCommandOptions {
	argv: string[];
	homeDir: string;
}

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
		default:
			printCronUsage();
			process.exit(1);
	}
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
