import { describe, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configCommand } from "../../../src/cli/commands/config.ts";

function createHomeDir() {
	return mkdtempSync(join(tmpdir(), "outclaw-config-command-"));
}

async function captureOutput(fn: () => void | Promise<void>) {
	const logs: string[] = [];
	const errors: string[] = [];
	const originalLog = console.log;
	const originalError = console.error;
	console.log = (...args: unknown[]) => logs.push(args.join(" "));
	console.error = (...args: unknown[]) => errors.push(args.join(" "));
	try {
		await fn();
		return { errors, logs };
	} finally {
		console.log = originalLog;
		console.error = originalError;
	}
}

function readJson(path: string) {
	return JSON.parse(readFileSync(path, "utf-8")) as unknown;
}

describe("configCommand", () => {
	test("runtime patches config through the shared update path and marks restart required", async () => {
		const homeDir = createHomeDir();
		try {
			mkdirSync(homeDir, { recursive: true });
			writeFileSync(join(homeDir, "daemon.pid"), `${process.pid}\n`);

			const output = await captureOutput(() =>
				configCommand({
					argv: [
						"bun",
						"oc",
						"config",
						"runtime",
						"--host",
						"0.0.0.0",
						"--port",
						"4100",
						"--auto-compact",
						"false",
						"--heartbeat-interval",
						"60",
						"--thinking-effort",
						"low",
					],
					homeDir,
				}),
			);

			expect(output.errors).toEqual([]);
			expect(output.logs).toEqual([
				"Configured runtime settings",
				"Restart required. Changes won't update until the runtime restarts.",
			]);
			expect(readJson(join(homeDir, "config.json"))).toMatchObject({
				autoCompact: false,
				host: "0.0.0.0",
				heartbeat: {
					intervalMinutes: 60,
					deferMinutes: 0,
				},
				port: 4100,
				thinkingEffort: "low",
			});
		} finally {
			rmSync(homeDir, { force: true, recursive: true });
		}
	});

	test("secure moves hardcoded Telegram settings while preserving env refs and unrelated config", async () => {
		const homeDir = createHomeDir();
		try {
			mkdirSync(join(homeDir, "agents", "railly"), { recursive: true });
			mkdirSync(join(homeDir, "agents", "mimi"), { recursive: true });
			writeFileSync(
				join(homeDir, "agents", "railly", ".agent-id"),
				"agent-railly\n",
			);
			writeFileSync(
				join(homeDir, "agents", "mimi", ".agent-id"),
				"agent-mimi\n",
			);
			writeFileSync(
				join(homeDir, "config.json"),
				JSON.stringify(
					{
						custom: {
							keep: true,
						},
						agents: {
							"agent-railly": {
								telegram: {
									botToken: "token-a",
									allowedUsers: [101, 202],
								},
							},
							"agent-mimi": {
								telegram: {
									botToken: "$MIMI_TELEGRAM_BOT_TOKEN",
									allowedUsers: "$MIMI_TELEGRAM_USERS",
								},
							},
						},
					},
					null,
					"\t",
				),
			);

			const output = await captureOutput(() =>
				configCommand({
					argv: ["bun", "oc", "config", "secure"],
					homeDir,
				}),
			);

			expect(output.errors).toEqual([]);
			expect(output.logs).toEqual([
				"config.json: agents/railly.telegram.botToken -> $RAILLY_TELEGRAM_BOT_TOKEN",
				"config.json: agents/railly.telegram.allowedUsers -> $RAILLY_TELEGRAM_USERS",
				"Updated .env",
			]);
			expect(readFileSync(join(homeDir, ".env"), "utf-8")).toContain(
				"RAILLY_TELEGRAM_BOT_TOKEN=token-a",
			);
			expect(readFileSync(join(homeDir, ".env"), "utf-8")).toContain(
				"RAILLY_TELEGRAM_USERS=101,202",
			);
			expect(readJson(join(homeDir, "config.json"))).toMatchObject({
				custom: {
					keep: true,
				},
				agents: {
					"agent-railly": {
						telegram: {
							botToken: "$RAILLY_TELEGRAM_BOT_TOKEN",
							allowedUsers: "$RAILLY_TELEGRAM_USERS",
						},
					},
					"agent-mimi": {
						telegram: {
							botToken: "$MIMI_TELEGRAM_BOT_TOKEN",
							allowedUsers: "$MIMI_TELEGRAM_USERS",
						},
					},
				},
			});
		} finally {
			rmSync(homeDir, { force: true, recursive: true });
		}
	});
});
