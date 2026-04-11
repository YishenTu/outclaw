import { describe, expect, mock, test } from "bun:test";
import { spawnDaemonRestart } from "../../../src/runtime/process/restart-daemon.ts";

describe("spawnDaemonRestart", () => {
	test("inherits stdout and stderr so restart failures are logged", () => {
		const spawn = mock(() => ({}) as never);

		spawnDaemonRestart("/tmp/cli.ts", spawn);

		expect(spawn).toHaveBeenCalledWith(["bun", "/tmp/cli.ts", "restart"], {
			stdin: "ignore",
			stdout: "inherit",
			stderr: "inherit",
		});
	});
});
