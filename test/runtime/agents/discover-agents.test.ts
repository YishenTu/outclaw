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
import { discoverAgents } from "../../../src/runtime/agents/discover-agents.ts";
import { readAgentConfig } from "../../../src/runtime/agents/read-agent-config.ts";
import { writeAgentConfig } from "../../../src/runtime/agents/write-agent-config.ts";

function tmp() {
	return mkdtempSync(join(tmpdir(), "outclaw-agents-"));
}

function createAgent(homeDir: string, name: string, agentId: string) {
	const agentHomeDir = join(homeDir, "agents", name);
	mkdirSync(agentHomeDir, { recursive: true });
	writeFileSync(join(agentHomeDir, ".agent-id"), `${agentId}\n`);
	return agentHomeDir;
}

describe("agent discovery", () => {
	test("returns agent records discovered from agent folders", () => {
		const homeDir = tmp();
		try {
			const raillyDir = createAgent(homeDir, "railly", "agent-railly");
			const mimiDir = createAgent(homeDir, "mimi-work", "agent-mimi");
			writeFileSync(
				join(homeDir, ".env"),
				[
					"RAILLY_BOT_TOKEN=railly-token",
					"RAILLY_ALLOWED_USERS=11,22",
					"MIMI_ALLOWED_USERS=33",
				].join("\n"),
			);
			writeFileSync(
				join(homeDir, "config.json"),
				JSON.stringify({
					agents: {
						"agent-railly": {
							telegram: {
								botToken: "$RAILLY_BOT_TOKEN",
								allowedUsers: "$RAILLY_ALLOWED_USERS",
							},
						},
						"agent-mimi": {
							telegram: {
								botToken: "",
								allowedUsers: "$MIMI_ALLOWED_USERS",
							},
						},
					},
				}),
			);

			const agents = discoverAgents(homeDir);
			expect(agents).toEqual([
				{
					agentId: "agent-mimi",
					name: "mimi-work",
					homeDir: mimiDir,
					promptHomeDir: mimiDir,
					configPath: join(homeDir, "config.json"),
					config: {
						rollover: {
							idleMinutes: 480,
						},
						telegram: {
							botToken: "",
							allowedUsers: [33],
							defaultCronUserId: undefined,
						},
					},
				},
				{
					agentId: "agent-railly",
					name: "railly",
					homeDir: raillyDir,
					promptHomeDir: raillyDir,
					configPath: join(homeDir, "config.json"),
					config: {
						rollover: {
							idleMinutes: 480,
						},
						telegram: {
							botToken: "railly-token",
							allowedUsers: [11, 22],
							defaultCronUserId: undefined,
						},
					},
				},
			]);
		} finally {
			rmSync(homeDir, { recursive: true });
		}
	});

	test("returns an empty list when no agents exist", () => {
		const homeDir = tmp();
		try {
			expect(discoverAgents(homeDir)).toEqual([]);
		} finally {
			rmSync(homeDir, { recursive: true });
		}
	});

	test("rejects agent folders without .agent-id", () => {
		const homeDir = tmp();
		try {
			mkdirSync(join(homeDir, "agents", "railly"), { recursive: true });
			expect(() => discoverAgents(homeDir)).toThrow(
				"Agent folder railly is missing .agent-id",
			);
		} finally {
			rmSync(homeDir, { recursive: true });
		}
	});

	test("rejects invalid agent folder names", () => {
		const homeDir = tmp();
		try {
			createAgent(homeDir, "Railly", "agent-railly");
			expect(() => discoverAgents(homeDir)).toThrow(
				"Invalid agent name: Railly",
			);
		} finally {
			rmSync(homeDir, { recursive: true });
		}
	});
});

describe("agent config", () => {
	test("reads agent-local telegram config from the shared .env file", () => {
		const homeDir = tmp();
		try {
			createAgent(homeDir, "railly", "agent-railly");
			writeFileSync(
				join(homeDir, ".env"),
				[
					"RAILLY_TELEGRAM_BOT_TOKEN=bot-token",
					"RAILLY_TELEGRAM_USERS=101,202",
				].join("\n"),
			);
			writeFileSync(
				join(homeDir, "config.json"),
				JSON.stringify({
					agents: {
						"agent-railly": {
							telegram: {
								botToken: "$RAILLY_TELEGRAM_BOT_TOKEN",
								allowedUsers: "$RAILLY_TELEGRAM_USERS",
							},
						},
					},
				}),
			);

			expect(readAgentConfig({ agentId: "agent-railly", homeDir })).toEqual({
				rollover: {
					idleMinutes: 480,
				},
				telegram: {
					botToken: "bot-token",
					allowedUsers: [101, 202],
					defaultCronUserId: undefined,
				},
			});
		} finally {
			rmSync(homeDir, { recursive: true });
		}
	});

	test("reads defaultCronUserId from shared agent config", () => {
		const homeDir = tmp();
		try {
			createAgent(homeDir, "railly", "agent-railly");
			writeFileSync(
				join(homeDir, "config.json"),
				JSON.stringify({
					agents: {
						"agent-railly": {
							telegram: {
								botToken: "",
								allowedUsers: [101, 202],
								defaultCronUserId: 202,
							},
						},
					},
				}),
			);

			expect(readAgentConfig({ agentId: "agent-railly", homeDir })).toEqual({
				rollover: {
					idleMinutes: 480,
				},
				telegram: {
					botToken: "",
					allowedUsers: [101, 202],
					defaultCronUserId: 202,
				},
			});
		} finally {
			rmSync(homeDir, { recursive: true });
		}
	});

	test("writes default agent config when none exists", () => {
		const homeDir = tmp();
		try {
			createAgent(homeDir, "railly", "agent-railly");

			const config = readAgentConfig({ agentId: "agent-railly", homeDir });

			expect(config).toEqual({
				rollover: {
					idleMinutes: 480,
				},
				telegram: {
					botToken: "",
					allowedUsers: [],
					defaultCronUserId: undefined,
				},
			});
			expect(
				JSON.parse(readFileSync(join(homeDir, "config.json"), "utf-8")),
			).toEqual({
				agents: {
					"agent-railly": {
						rollover: {
							idleMinutes: 480,
						},
						telegram: {
							botToken: "",
							allowedUsers: [],
						},
					},
				},
				autoCompact: true,
				host: "127.0.0.1",
				heartbeat: {
					intervalMinutes: 30,
					deferMinutes: 0,
				},
				port: 4000,
			});
		} finally {
			rmSync(homeDir, { recursive: true });
		}
	});

	test("reads per-agent rollover idle override from shared agent config", () => {
		const homeDir = tmp();
		try {
			createAgent(homeDir, "railly", "agent-railly");
			writeFileSync(
				join(homeDir, "config.json"),
				JSON.stringify({
					agents: {
						"agent-railly": {
							rollover: {
								idleMinutes: 90,
							},
							telegram: {
								botToken: "",
								allowedUsers: [],
							},
						},
					},
				}),
			);

			expect(readAgentConfig({ agentId: "agent-railly", homeDir })).toEqual({
				rollover: {
					idleMinutes: 90,
				},
				telegram: {
					botToken: "",
					allowedUsers: [],
					defaultCronUserId: undefined,
				},
			});
		} finally {
			rmSync(homeDir, { recursive: true });
		}
	});

	test("writeAgentConfig persists agent-local config shape", () => {
		const homeDir = tmp();
		try {
			createAgent(homeDir, "railly", "agent-railly");

			writeAgentConfig({
				agentId: "agent-railly",
				config: {
					telegram: {
						botToken: "$BOT_TOKEN",
						allowedUsers: "$ALLOWED_USERS",
						defaultCronUserId: 123,
					},
				},
				homeDir,
			});

			expect(
				JSON.parse(readFileSync(join(homeDir, "config.json"), "utf-8")),
			).toEqual({
				agents: {
					"agent-railly": {
						rollover: {
							idleMinutes: 480,
						},
						telegram: {
							botToken: "$BOT_TOKEN",
							allowedUsers: "$ALLOWED_USERS",
							defaultCronUserId: 123,
						},
					},
				},
				autoCompact: true,
				host: "127.0.0.1",
				heartbeat: {
					intervalMinutes: 30,
					deferMinutes: 0,
				},
				port: 4000,
			});
		} finally {
			rmSync(homeDir, { recursive: true });
		}
	});
});
