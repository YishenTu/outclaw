import { describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareAgentWorkspace } from "../../../src/backend/agent-workspace.ts";
import { completeAgentOnboarding } from "../../../src/runtime/agents/complete-agent-onboarding.ts";
import { readAgentId } from "../../../src/runtime/agents/read-agent-id.ts";

function createHomeDir() {
	return mkdtempSync(join(tmpdir(), "outclaw-onboard-"));
}

function createTemplatesDir() {
	const templatesDir = mkdtempSync(
		join(tmpdir(), "outclaw-onboard-templates-"),
	);
	writeFileSync(join(templatesDir, "SOUL.md"), "Soul\n");
	return templatesDir;
}

describe("agent onboarding", () => {
	test("completeAgentOnboarding creates an agent with Telegram settings and .env", async () => {
		const homeDir = createHomeDir();
		const templatesDir = createTemplatesDir();
		try {
			const created = completeAgentOnboarding({
				allowedUsers: [2, 1],
				botToken: "token-a",
				createAgentId: () => "agent-railly",
				homeDir,
				name: "railly",
				prepareWorkspace: prepareAgentWorkspace,
				templatesDir,
			});

			expect(created.agentId).toBe("agent-railly");
			expect(readAgentId(created.agentHomeDir)).toBe("agent-railly");
			expect(existsSync(join(homeDir, ".env"))).toBe(true);
			expect(
				JSON.parse(readFileSync(join(homeDir, "config.json"), "utf-8")),
			).toEqual({
				agents: {
					"agent-railly": {
						rollover: {
							idleMinutes: 480,
						},
						telegram: {
							allowedUsers: [2, 1],
							botToken: "token-a",
						},
					},
				},
				autoCompact: true,
				host: "127.0.0.1",
				heartbeat: {
					deferMinutes: 0,
					intervalMinutes: 30,
				},
				port: 4000,
				thinkingEffort: "medium",
			});
		} finally {
			rmSync(homeDir, { force: true, recursive: true });
			rmSync(templatesDir, { force: true, recursive: true });
		}
	});

	test("completeAgentOnboarding creates an agent-only setup when Telegram is skipped", async () => {
		const homeDir = createHomeDir();
		const templatesDir = createTemplatesDir();
		try {
			const created = completeAgentOnboarding({
				createAgentId: () => "agent-railly",
				homeDir,
				name: "railly",
				prepareWorkspace: prepareAgentWorkspace,
				templatesDir,
			});

			expect(created.agentId).toBe("agent-railly");
			expect(existsSync(join(homeDir, ".env"))).toBe(true);
			expect(
				JSON.parse(readFileSync(join(homeDir, "config.json"), "utf-8")),
			).toEqual({
				agents: {
					"agent-railly": {
						rollover: {
							idleMinutes: 480,
						},
						telegram: {
							allowedUsers: [],
							botToken: "",
						},
					},
				},
				autoCompact: true,
				host: "127.0.0.1",
				heartbeat: {
					deferMinutes: 0,
					intervalMinutes: 30,
				},
				port: 4000,
				thinkingEffort: "medium",
			});
		} finally {
			rmSync(homeDir, { force: true, recursive: true });
			rmSync(templatesDir, { force: true, recursive: true });
		}
	});
});
