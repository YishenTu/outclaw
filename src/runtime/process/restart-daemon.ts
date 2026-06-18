type SpawnProcess = (
	command: string[],
	options: {
		detached: true;
		stdin: "ignore";
		stdout: "inherit";
		stderr: "inherit";
	},
) => { unref?: () => void };

export const RESTART_WORKER_FLAG = "--outclaw-restart-worker";

export function spawnDaemonRestart(
	cliEntry: string,
	spawn: SpawnProcess = Bun.spawn as SpawnProcess,
) {
	const child = spawn(["bun", cliEntry, "restart", RESTART_WORKER_FLAG], {
		detached: true,
		stdin: "ignore",
		stdout: "inherit",
		stderr: "inherit",
	});
	child.unref?.();
	return child;
}
