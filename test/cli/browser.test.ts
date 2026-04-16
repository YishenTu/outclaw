import { describe, expect, mock, test } from "bun:test";
import { launchBrowserFrontend } from "../../src/cli/browser.ts";

describe("launchBrowserFrontend", () => {
	test("launches the browser dev server in the browser workspace", () => {
		const spawnSync = mock(() => ({}) as never);

		launchBrowserFrontend(
			{
				argv: ["bun", "/tmp/cli.ts", "browser"],
				browserDir: "/tmp/browser",
				runtimeRunning: true,
			},
			{
				env: { BUN_ENV: "test" },
				log: mock((_message: string) => undefined),
				spawnSync,
			},
		);

		expect(spawnSync).toHaveBeenCalledWith(["bun", "run", "dev"], {
			cwd: "/tmp/browser",
			env: { BUN_ENV: "test" },
			stdio: ["inherit", "inherit", "inherit"],
		});
	});

	test("forwards extra arguments to the browser dev server", () => {
		const spawnSync = mock(() => ({}) as never);

		launchBrowserFrontend(
			{
				argv: [
					"bun",
					"/tmp/cli.ts",
					"browser",
					"--host",
					"0.0.0.0",
					"--port",
					"3001",
				],
				browserDir: "/tmp/browser",
				runtimeRunning: true,
			},
			{
				env: {},
				log: mock((_message: string) => undefined),
				spawnSync,
			},
		);

		expect(spawnSync).toHaveBeenCalledWith(
			["bun", "run", "dev", "--host", "0.0.0.0", "--port", "3001"],
			{
				cwd: "/tmp/browser",
				env: {},
				stdio: ["inherit", "inherit", "inherit"],
			},
		);
	});

	test("warns when the runtime daemon is not running", () => {
		const log = mock((_message: string) => undefined);
		const spawnSync = mock(() => ({}) as never);

		launchBrowserFrontend(
			{
				argv: ["bun", "/tmp/cli.ts", "browser"],
				browserDir: "/tmp/browser",
				runtimeRunning: false,
			},
			{
				env: {},
				log,
				spawnSync,
			},
		);

		expect(log).toHaveBeenCalledWith(
			"Daemon is not running. Browser will connect once you start it with `oc start`.",
		);
	});
});
