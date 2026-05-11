import { describe, expect, test } from "bun:test";
import { CodexAppServerProcess } from "../../../src/backend/adapters/codex/app-server-process.ts";

describe("CodexAppServerProcess", () => {
	test("consumes stderr from the app-server subprocess", async () => {
		let stderr = "";
		const appServerProcess = new CodexAppServerProcess({
			command: process.execPath,
			args: ["-e", "process.stderr.write('codex warning')"],
			onStderr: (chunk) => {
				stderr += chunk;
			},
		});
		const exited = new Promise<void>((resolve) => {
			appServerProcess.onExit(() => resolve());
		});

		appServerProcess.start();
		await exited;

		expect(stderr).toBe("codex warning");
	});
});
