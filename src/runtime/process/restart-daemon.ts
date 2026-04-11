type SpawnProcess = (
	command: string[],
	options: {
		stdin: "ignore";
		stdout: "inherit";
		stderr: "inherit";
	},
) => unknown;

export function spawnDaemonRestart(
	cliEntry: string,
	spawn: SpawnProcess = Bun.spawn as SpawnProcess,
) {
	return spawn(["bun", cliEntry, "restart"], {
		stdin: "ignore",
		stdout: "inherit",
		stderr: "inherit",
	});
}
