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
import { onboardFirstAgent } from "../../../src/runtime/agents/onboard-first-agent.ts";
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
	test("onboardFirstAgent creates the first agent and .env from prompted answers", async () => {
		const homeDir = createHomeDir();
		const templatesDir = createTemplatesDir();
		const prompts: string[] = [];
		try {
			const created = await onboardFirstAgent({
				createAgentId: () => "agent-railly",
				homeDir,
				io: {
					log: (_message) => undefined,
					prompt: async (message) => {
						prompts.push(message);
						if (message.includes("Agent name")) return "railly";
						if (message.includes("Bot token")) return "token-a";
						return "2,1";
					},
				},
				prepareWorkspace: prepareAgentWorkspace,
				templatesDir,
			});

			expect(prompts).toEqual([
				"Agent name: ",
				"Bot token: ",
				"Allowed user IDs (comma-separated): ",
			]);
			expect(created.agentId).toBe("agent-railly");
			expect(readAgentId(created.agentHomeDir)).toBe("agent-railly");
			expect(existsSync(join(homeDir, ".env"))).toBe(true);
			expect(
				JSON.parse(readFileSync(join(homeDir, "config.json"), "utf-8")),
			).toEqual({
				agents: {
					"agent-railly": {
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
			});
		} finally {
			rmSync(homeDir, { force: true, recursive: true });
			rmSync(templatesDir, { force: true, recursive: true });
		}
	});
});
