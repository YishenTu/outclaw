import { describe, expect, mock, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	applyOnboardingSubmission,
	restartDaemonViaCli,
} from "../../../src/cli/commands/onboard.ts";

function createHomeDir() {
	return mkdtempSync(join(tmpdir(), "outclaw-onboard-cli-"));
}

function createTemplatesDir() {
	const templatesDir = mkdtempSync(
		join(tmpdir(), "outclaw-onboard-cli-templates-"),
	);
	writeFileSync(join(templatesDir, "SOUL.md"), "Soul\n");
	return templatesDir;
}

describe("CLI onboarding helpers", () => {
	test("applyOnboardingSubmission can create a quick agent and enable LAN mode", () => {
		const homeDir = createHomeDir();
		const templatesDir = createTemplatesDir();
		try {
			const result = applyOnboardingSubmission({
				createAgentId: () => "agent-railly",
				homeDir,
				submission: {
					enableLan: true,
					mode: "quick",
					name: "railly",
					scope: "agent",
				},
				templatesDir,
			});

			expect(result.lanEnabled).toBe(true);
			expect(result.securedConfig).toBe(false);
			expect(result.created.agentId).toBe("agent-railly");
			expect(
				JSON.parse(readFileSync(join(homeDir, "config.json"), "utf-8")),
			).toMatchObject({
				agents: {
					"agent-railly": {
						telegram: {
							allowedUsers: [],
							botToken: "",
						},
					},
				},
				host: "0.0.0.0",
			});
		} finally {
			rmSync(homeDir, { force: true, recursive: true });
			rmSync(templatesDir, { force: true, recursive: true });
		}
	});

	test("applyOnboardingSubmission can secure Telegram config into .env", () => {
		const homeDir = createHomeDir();
		const templatesDir = createTemplatesDir();
		try {
			const result = applyOnboardingSubmission({
				createAgentId: () => "agent-railly",
				homeDir,
				submission: {
					allowedUsers: [2, 1],
					botToken: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ",
					enableLan: false,
					mode: "full",
					name: "railly",
					scope: "agent+telegram",
					secureTelegramConfig: true,
				},
				templatesDir,
			});

			expect(result.lanEnabled).toBe(false);
			expect(result.securedConfig).toBe(true);
			expect(existsSync(join(homeDir, ".env"))).toBe(true);
			expect(readFileSync(join(homeDir, ".env"), "utf-8")).toContain(
				"RAILLY_TELEGRAM_BOT_TOKEN=123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ",
			);
			expect(readFileSync(join(homeDir, ".env"), "utf-8")).toContain(
				"RAILLY_TELEGRAM_USERS=2,1",
			);
			expect(
				JSON.parse(readFileSync(join(homeDir, "config.json"), "utf-8")),
			).toMatchObject({
				agents: {
					"agent-railly": {
						telegram: {
							allowedUsers: "$RAILLY_TELEGRAM_USERS",
							botToken: "$RAILLY_TELEGRAM_BOT_TOKEN",
						},
					},
				},
				host: "127.0.0.1",
			});
		} finally {
			rmSync(homeDir, { force: true, recursive: true });
			rmSync(templatesDir, { force: true, recursive: true });
		}
	});

	test("restartDaemonViaCli shells into the restart command", () => {
		const spawnSync = mock(() => ({ exitCode: 0 }) as never);

		const exitCode = restartDaemonViaCli("/tmp/cli.ts", spawnSync);

		expect(exitCode).toBe(0);
		expect(spawnSync).toHaveBeenCalledWith(["bun", "/tmp/cli.ts", "restart"], {
			env: process.env,
			stdio: ["inherit", "inherit", "inherit"],
		});
	});
});
