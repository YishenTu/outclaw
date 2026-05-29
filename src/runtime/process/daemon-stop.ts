import type { PidManager } from "./pid-manager.ts";

type SignalProcess = (pid: number, signal: NodeJS.Signals | 0) => void;

interface DaemonPidStore
	extends Pick<PidManager, "isRunning" | "read" | "remove"> {}

interface WaitForProcessExitOptions {
	kill?: SignalProcess;
	now?: () => number;
	pollIntervalMs?: number;
	sleep?: (ms: number) => Promise<void>;
	timeoutMs?: number;
}

interface StopDaemonOptions {
	kill?: SignalProcess;
	waitForExit?: (pid: number, phase: "graceful" | "force") => Promise<boolean>;
}

export type StopDaemonResult =
	| { status: "not_running"; pid?: number }
	| { status: "stopped"; pid: number }
	| { status: "killed"; pid: number }
	| { status: "timeout"; pid: number };

const FORCE_KILL_WAIT_MS = 1000;

export async function waitForProcessExit(
	pid: number,
	options: WaitForProcessExitOptions = {},
): Promise<boolean> {
	const kill = options.kill ?? process.kill.bind(process);
	const now = options.now ?? Date.now;
	const sleep = options.sleep ?? Bun.sleep;
	const pollIntervalMs = options.pollIntervalMs ?? 50;
	const timeoutMs = options.timeoutMs ?? 5000;
	const deadline = now() + timeoutMs;

	while (now() < deadline) {
		try {
			kill(pid, 0);
		} catch (err: unknown) {
			const code = (err as NodeJS.ErrnoException).code;
			if (code === "ESRCH") {
				return true;
			}
			throw err;
		}
		await sleep(pollIntervalMs);
	}

	return false;
}

export async function stopDaemon(
	pidStore: DaemonPidStore,
	options: StopDaemonOptions = {},
): Promise<StopDaemonResult> {
	const pid = pidStore.read();
	if (!pid || !pidStore.isRunning()) {
		pidStore.remove();
		return { status: "not_running", pid };
	}

	const kill = options.kill ?? process.kill.bind(process);
	kill(pid, "SIGTERM");

	const waitForExit =
		options.waitForExit ??
		((targetPid: number, phase: "graceful" | "force") =>
			waitForProcessExit(targetPid, {
				kill,
				timeoutMs: phase === "force" ? FORCE_KILL_WAIT_MS : undefined,
			}));
	const exited = await waitForExit(pid, "graceful");
	if (exited) {
		pidStore.remove();
		return { status: "stopped", pid };
	}

	kill(pid, "SIGKILL");
	const killed = await waitForExit(pid, "force");
	if (killed) {
		pidStore.remove();
		return { status: "killed", pid };
	}

	return { status: "timeout", pid };
}
