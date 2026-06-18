import {
	copyFileSync,
	existsSync,
	mkdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { ClaudeAdapter } from "../../backend/adapters/claude/index.ts";
import { CodexAdapter } from "../../backend/adapters/codex/index.ts";
import { PiAdapter } from "../../backend/adapters/pi/index.ts";
import { listAgents } from "../../runtime/agents/list-agents.ts";
import { stopDaemon } from "../../runtime/process/daemon-stop.ts";
import { PidManager } from "../../runtime/process/pid-manager.ts";
import { RESTART_WORKER_FLAG } from "../../runtime/process/restart-daemon.ts";
import { seedTemplates } from "../../runtime/prompt/seed-templates.ts";
import { launchBrowserFrontend } from "../support/browser.ts";
import {
	buildBrowserFrontend,
	ensureBrowserBuild,
} from "../support/browser-build.ts";
import {
	applyStartRuntimeFlags,
	parseStartRuntimeFlags,
} from "../support/start-runtime-flags.ts";
import { promptAndApplyOnboarding } from "./onboard.ts";

interface DaemonCommandOptions {
	argv: string[];
	browserDir: string;
	cliEntry: string;
	daemonEntry: string;
	env?: NodeJS.ProcessEnv;
	homeDir: string;
	logPath: string;
	pidPath: string;
	readyPath: string;
	spawnDetachedRestart?: (
		command: string[],
		options: {
			detached: true;
			env: NodeJS.ProcessEnv;
			stderr: unknown;
			stdin: "ignore";
			stdout: unknown;
		},
	) => { pid?: number; unref?: () => void };
	templatesDir: string;
	tuiEntry: string;
	prepareWorkspaces?: (agentHomeDirs: string[]) => void;
}

const DAEMON_READY_TIMEOUT_MS = 5000;
const DAEMON_READY_POLL_MS = 100;

export function createDaemonCommands(options: DaemonCommandOptions) {
	const pid = new PidManager(options.pidPath);

	return {
		async start() {
			mkdirSync(options.homeDir, { recursive: true });
			parseStartRuntimeFlags(options.argv.slice(3));

			if (pid.isRunning()) {
				console.log(`Daemon already running (pid ${pid.read()})`);
				process.exit(1);
			}

			if (listAgents(options.homeDir).length === 0) {
				await runFreshInstallOnboarding(options.homeDir, options.templatesDir);
			}
			if (
				prepareDaemonStart(options, pid, { allowRunning: false }) === "running"
			) {
				console.log(`Daemon already running (pid ${pid.read()})`);
				process.exit(1);
			}

			await launchPreparedDaemon(options, pid);
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
					`Warning: daemon (pid ${result.pid}) did not exit after SIGTERM and SIGKILL`,
				);
				process.exit(1);
			}

			if (result.status === "killed") {
				console.log(
					`Daemon force-stopped after graceful shutdown timed out (pid ${result.pid})`,
				);
				return;
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

		async restart() {
			const restartArgs = publicRestartArgs(options.argv.slice(3));
			if (
				!isRestartWorker(options.argv.slice(3)) &&
				isActiveAgentSession(options.env ?? process.env)
			) {
				handoffRestart(options, restartArgs);
				return;
			}

			mkdirSync(options.homeDir, { recursive: true });
			parseStartRuntimeFlags(restartArgs);
			if (listAgents(options.homeDir).length === 0) {
				await runFreshInstallOnboarding(options.homeDir, options.templatesDir);
			}
			prepareDaemonStart(options, pid, {
				allowRunning: true,
				startArgs: restartArgs,
			});
			await this.stop();
			await launchPreparedDaemon(options, pid);
		},
	};
}

async function launchPreparedDaemon(
	options: DaemonCommandOptions,
	pid: PidManager,
) {
	pid.remove();
	if (existsSync(options.readyPath)) {
		rmSync(options.readyPath, { force: true });
	}

	rotateDaemonLog(options.logPath);
	const logFile = Bun.file(options.logPath);
	const child = Bun.spawn(["bun", options.daemonEntry], {
		stdout: logFile,
		stderr: logFile,
		stdin: "ignore",
		env: { ...process.env },
		detached: true,
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
}

function rotateDaemonLog(logPath: string): void {
	if (existsSync(logPath)) {
		copyFileSync(logPath, `${logPath}.previous`);
	}
	writeFileSync(logPath, "");
}

function prepareDaemonStart(
	options: DaemonCommandOptions,
	pid: PidManager,
	{
		allowRunning,
		startArgs = options.argv.slice(3),
	}: { allowRunning: boolean; startArgs?: string[] },
): "ready" | "running" {
	mkdirSync(options.homeDir, { recursive: true });
	parseStartRuntimeFlags(startArgs);

	if (pid.isRunning() && !allowRunning) {
		return "running";
	}

	applyStartRuntimeFlags(options.homeDir, startArgs);
	reseedMissingAgentTemplates(options.homeDir, options.templatesDir);
	ensureBrowserBuild({
		browserDir: options.browserDir,
	});

	const agentHomeDirs = listAgents(options.homeDir).map(
		(agent) => agent.promptHomeDir,
	);
	if (options.prepareWorkspaces) {
		options.prepareWorkspaces(agentHomeDirs);
	} else {
		prepareProviderWorkspaces(agentHomeDirs);
	}

	return "ready";
}

function publicRestartArgs(args: string[]): string[] {
	return args.filter((arg) => arg !== RESTART_WORKER_FLAG);
}

function isRestartWorker(args: string[]): boolean {
	return args.includes(RESTART_WORKER_FLAG);
}

function isActiveAgentSession(env: NodeJS.ProcessEnv): boolean {
	return Boolean(env.OC_SESSION_ID || env.OC_MEMORY_ROOT);
}

function handoffRestart(options: DaemonCommandOptions, args: string[]): never {
	const restartLogPath = `${options.logPath}.restart`;
	writeFileSync(
		restartLogPath,
		`restart handoff requested at ${new Date().toISOString()}\n`,
	);
	const spawn = options.spawnDetachedRestart ?? Bun.spawn;
	const child = spawn(
		["bun", options.cliEntry, "restart", RESTART_WORKER_FLAG, ...args],
		{
			detached: true,
			env: createRestartWorkerEnv(options.env ?? process.env),
			stderr: Bun.file(restartLogPath),
			stdin: "ignore",
			stdout: Bun.file(restartLogPath),
		},
	);
	child.unref?.();
	console.log(
		`Daemon restart handed off${child.pid ? ` (pid ${child.pid})` : ""}`,
	);
	console.log(`Log: ${restartLogPath}`);
	process.exit(0);
}

function createRestartWorkerEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const workerEnv = { ...env };
	delete workerEnv.OC_SESSION_ID;
	delete workerEnv.OC_MEMORY_ROOT;
	return workerEnv;
}

function prepareProviderWorkspaces(agentHomeDirs: string[]): void {
	if (agentHomeDirs.length === 0) {
		return;
	}

	const claudeAdapter = new ClaudeAdapter();
	const codexAdapter = new CodexAdapter();
	const piAdapter = new PiAdapter();

	try {
		for (const agentHomeDir of agentHomeDirs) {
			claudeAdapter.prepareWorkspace(agentHomeDir);
			codexAdapter.prepareWorkspace(agentHomeDir);
			piAdapter.prepareWorkspace(agentHomeDir);
		}
	} finally {
		void codexAdapter.dispose();
		void piAdapter.dispose();
	}
}

async function runFreshInstallOnboarding(
	homeDir: string,
	templatesDir: string,
) {
	const created = await promptAndApplyOnboarding({
		homeDir,
		templatesDir,
	});
	if (!created) {
		console.log("Onboarding cancelled");
		process.exit(1);
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
