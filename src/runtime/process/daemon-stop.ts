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
	waitForExit?: (pid: number) => Promise<boolean>;
}

export type StopDaemonResult =
	| { status: "not_running"; pid?: number }
	| { status: "stopped"; pid: number }
	| { status: "timeout"; pid: number };

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
		((targetPid: number) => waitForProcessExit(targetPid));
	const exited = await waitForExit(pid);
	if (!exited) {
		return { status: "timeout", pid };
	}

	pidStore.remove();
	return { status: "stopped", pid };
}
