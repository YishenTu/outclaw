import { describe, expect, mock, test } from "bun:test";
import {
	RESTART_WORKER_FLAG,
	spawnDaemonRestart,
} from "../../../src/runtime/process/restart-daemon.ts";

describe("spawnDaemonRestart", () => {
	test("spawns a detached restart worker so daemon shutdown cannot kill the handoff", () => {
		const unref = mock(() => undefined);
		const spawn = mock(() => ({ unref }));

		spawnDaemonRestart("/tmp/cli.ts", spawn);

		expect(spawn).toHaveBeenCalledWith(
			["bun", "/tmp/cli.ts", "restart", RESTART_WORKER_FLAG],
			{
				detached: true,
				stdin: "ignore",
				stdout: "inherit",
				stderr: "inherit",
			},
		);
		expect(unref).toHaveBeenCalled();
	});
});
