import { mkdirSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { listAgents } from "../runtime/agents/list-agents.ts";
import { onboardFirstAgent } from "../runtime/agents/onboard-first-agent.ts";
import { stopDaemon } from "../runtime/process/daemon-stop.ts";
import { PidManager } from "../runtime/process/pid-manager.ts";

interface DaemonCommandOptions {
	argv: string[];
	daemonEntry: string;
	homeDir: string;
	logPath: string;
	pidPath: string;
	printUsage: () => void;
	templatesDir: string;
	tuiEntry: string;
}

export function createDaemonCommands(options: DaemonCommandOptions) {
	const pid = new PidManager(options.pidPath);

	return {
		async start() {
			mkdirSync(options.homeDir, { recursive: true });

			if (pid.isRunning()) {
				console.log(`Daemon already running (pid ${pid.read()})`);
				process.exit(1);
			}

			if (listAgents(options.homeDir).length === 0) {
				await runFreshInstallOnboarding(options.homeDir, options.templatesDir);
			}

			pid.remove();

			const logFile = Bun.file(options.logPath);
			const child = Bun.spawn(["bun", options.daemonEntry], {
				stdout: logFile,
				stderr: logFile,
				stdin: "ignore",
				env: { ...process.env },
			});

			pid.write(child.pid);

			setTimeout(() => {
				if (pid.isRunning()) {
					console.log(`Daemon started (pid ${child.pid})`);
					console.log(`Log: ${options.logPath}`);
				} else {
					console.log("Daemon failed to start. Check logs:");
					console.log(`  cat ${options.logPath}`);
					pid.remove();
					process.exit(1);
				}
				process.exit(0);
			}, 500);
		},

		async stop() {
			const result = await stopDaemon(pid);

			if (result.status === "not_running") {
				console.log("Daemon is not running");
				return;
			}

			if (result.status === "timeout") {
				console.error(
					`Warning: daemon (pid ${result.pid}) did not exit within 5s`,
				);
				process.exit(1);
			}

			console.log(`Daemon stopped (pid ${result.pid})`);
		},

		status() {
			const runningPid = pid.read();
			if (runningPid && pid.isRunning()) {
				console.log(`Daemon running (pid ${runningPid})`);
			} else {
				console.log("Daemon is not running");
				if (runningPid) pid.remove();
			}
		},

		dev() {
			mkdirSync(options.homeDir, { recursive: true });

			if (pid.isRunning()) {
				console.log(
					`Daemon already running (pid ${pid.read()}). Stop it first: oc stop`,
				);
				process.exit(1);
			}

			Bun.spawnSync(["bun", "--hot", options.daemonEntry], {
				stdio: ["inherit", "inherit", "inherit"],
				env: { ...process.env },
			});
		},

		tui(explicitAgentName?: string) {
			if (!pid.isRunning()) {
				console.log("Daemon is not running. Start it first: oc start");
				process.exit(1);
			}

			const watch = options.argv.includes("--watch");
			const extraArgs = options.argv
				.slice(explicitAgentName ? 4 : 3)
				.filter((argument) => argument !== "--watch");
			if (explicitAgentName) {
				extraArgs.unshift(explicitAgentName);
				extraArgs.unshift("--agent");
			}
			const args = watch
				? ["bun", "--watch", options.tuiEntry, ...extraArgs]
				: ["bun", options.tuiEntry, ...extraArgs];
			Bun.spawnSync(args, {
				stdio: ["inherit", "inherit", "inherit"],
				env: { ...process.env },
			});
		},

		restart() {
			return this.stop().then(() => {
				void this.start();
			});
		},

		printUsage() {
			options.printUsage();
		},
	};
}

async function runFreshInstallOnboarding(
	homeDir: string,
	templatesDir: string,
) {
	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	try {
		await onboardFirstAgent({
			homeDir,
			io: {
				log: (message) => console.log(`\n${message}\n`),
				prompt: (message) => rl.question(message),
			},
			templatesDir,
		});
	} finally {
		rl.close();
	}
}
