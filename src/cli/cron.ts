import { loadGlobalConfig } from "../runtime/config.ts";
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
	const ws = new WebSocket(`ws://localhost:${params.port}/?client=control`);

	return new Promise<void>((resolve, reject) => {
		let settled = false;
		let opened = false;

		const finish = (fn: () => void) => {
			if (settled) {
				return;
			}
			settled = true;
			fn();
		};

		ws.addEventListener("open", () => {
			opened = true;
			ws.send(
				JSON.stringify({
					type: "cron_run",
					cwd: params.cwd,
					jobName: params.jobName,
				}),
			);
		});

		ws.addEventListener("message", (event) => {
			const data = JSON.parse(String(event.data)) as {
				type: string;
				message?: string;
			};
			if (data.type === "cron_run_response") {
				finish(resolve);
				ws.close();
				return;
			}
			if (data.type === "cron_run_error") {
				finish(() => reject(new Error(data.message ?? "cron run failed")));
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
							? "cron run connection closed before response"
							: "daemon not running",
					),
				),
			);
		});
	});
}
