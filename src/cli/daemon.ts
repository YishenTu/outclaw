import { existsSync, mkdirSync, rmSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { prepareAgentWorkspace } from "../backend/agent-workspace.ts";
import { listAgents } from "../runtime/agents/list-agents.ts";
import { onboardFirstAgent } from "../runtime/agents/onboard-first-agent.ts";
import { stopDaemon } from "../runtime/process/daemon-stop.ts";
import { PidManager } from "../runtime/process/pid-manager.ts";
import { seedTemplates } from "../runtime/prompt/seed-templates.ts";
import { launchBrowserFrontend } from "./browser.ts";
import { buildBrowserFrontend, ensureBrowserBuild } from "./browser-build.ts";
import { applyStartRuntimeFlags } from "./start-runtime-flags.ts";

interface DaemonCommandOptions {
	argv: string[];
	browserDir: string;
	daemonEntry: string;
	homeDir: string;
	logPath: string;
	pidPath: string;
	readyPath: string;
	templatesDir: string;
	tuiEntry: string;
}

const DAEMON_READY_TIMEOUT_MS = 5000;
const DAEMON_READY_POLL_MS = 100;

export function createDaemonCommands(options: DaemonCommandOptions) {
	const pid = new PidManager(options.pidPath);

	return {
		async start() {
			mkdirSync(options.homeDir, { recursive: true });

			if (pid.isRunning()) {
				console.log(`Daemon already running (pid ${pid.read()})`);
				process.exit(1);
			}

			applyStartRuntimeFlags(options.homeDir, options.argv.slice(3));

			if (listAgents(options.homeDir).length === 0) {
				await runFreshInstallOnboarding(options.homeDir, options.templatesDir);
			}
			reseedMissingAgentTemplates(options.homeDir, options.templatesDir);
			ensureBrowserBuild({
				browserDir: options.browserDir,
			});

			pid.remove();
			if (existsSync(options.readyPath)) {
				rmSync(options.readyPath, { force: true });
			}

			const logFile = Bun.file(options.logPath);
			const child = Bun.spawn(["bun", options.daemonEntry], {
				stdout: logFile,
				stderr: logFile,
				stdin: "ignore",
				env: { ...process.env },
			});
			child.unref();

			pid.write(child.pid);

			const deadline = Date.now() + DAEMON_READY_TIMEOUT_MS;
			while (Date.now() < deadline) {
				if (existsSync(options.readyPath)) {
					console.log(`Daemon started (pid ${child.pid})`);
					console.log(`Log: ${options.logPath}`);
					process.exit(0);
				}
				if (!pid.isRunning()) {
					console.log("Daemon failed to start. Check logs:");
					console.log(`  cat ${options.logPath}`);
					pid.remove();
					process.exit(1);
				}
				await Bun.sleep(DAEMON_READY_POLL_MS);
			}

			console.log("Daemon failed to become ready. Check logs:");
			console.log(`  cat ${options.logPath}`);
			pid.remove();
			process.exit(1);
		},

		build() {
			buildBrowserFrontend({
				browserDir: options.browserDir,
			});
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

		browser() {
			launchBrowserFrontend({
				argv: options.argv,
				browserDir: options.browserDir,
				runtimeRunning: pid.isRunning(),
			});
		},

		restart() {
			return this.stop().then(() => {
				void this.start();
			});
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
			prepareWorkspace: prepareAgentWorkspace,
			templatesDir,
		});
	} finally {
		rl.close();
	}
}

function reseedMissingAgentTemplates(homeDir: string, templatesDir: string) {
	for (const agent of listAgents(homeDir)) {
		const result = seedTemplates(agent.promptHomeDir, templatesDir, {
			agentName: agent.name,
		});
		if (result.seeded.length > 0) {
			console.log(`Seeded templates for ${agent.name}:`);
			for (const file of result.seeded) {
				console.log(`  ${file}`);
			}
		}
	}
}
