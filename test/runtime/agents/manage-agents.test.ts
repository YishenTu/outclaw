import { describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareAgentWorkspace } from "../../../src/backend/agent-workspace.ts";
import { createAgent as createAgentBase } from "../../../src/runtime/agents/create-agent.ts";
import { listAgents } from "../../../src/runtime/agents/list-agents.ts";
import { readAgentId } from "../../../src/runtime/agents/read-agent-id.ts";
import { removeAgent } from "../../../src/runtime/agents/remove-agent.ts";
import { renameAgent } from "../../../src/runtime/agents/rename-agent.ts";
import { updateAgent } from "../../../src/runtime/agents/update-agent.ts";
import { SessionStore } from "../../../src/runtime/persistence/session-store.ts";
import { TelegramRouteStore } from "../../../src/runtime/persistence/telegram-route-store.ts";

function createHomeDir() {
	return mkdtempSync(join(tmpdir(), "outclaw-agent-manage-"));
}

function createTemplatesDir() {
	const templatesDir = mkdtempSync(join(tmpdir(), "outclaw-templates-"));
	writeFileSync(join(templatesDir, "AGENTS.md"), "Agent instructions\n");
	mkdirSync(join(templatesDir, "skills"), { recursive: true });
	writeFileSync(join(templatesDir, "skills", "SKILL.md"), "Skill text\n");
	return templatesDir;
}

const REPO_TEMPLATES_DIR = join(import.meta.dir, "../../../src/templates");

function createAgent(
	options: Omit<Parameters<typeof createAgentBase>[0], "prepareWorkspace">,
) {
	return createAgentBase({
		...options,
		prepareWorkspace: prepareAgentWorkspace,
	});
}

describe("agent management", () => {
	test("createAgent seeds a new agent directory, config, and Claude skills symlink", () => {
		const homeDir = createHomeDir();
		const templatesDir = createTemplatesDir();
		try {
			const created = createAgent({
				allowedUsers: [2, 1],
				botToken: "token-a",
				homeDir,
				name: "railly",
				templatesDir,
				createAgentId: () => "agent-railly",
			});

			expect(created).toEqual({
				agentHomeDir: join(homeDir, "agents", "railly"),
				agentId: "agent-railly",
				configPath: join(homeDir, "config.json"),
			});
			expect(readAgentId(created.agentHomeDir)).toBe("agent-railly");
			expect(
				readFileSync(join(created.agentHomeDir, "AGENTS.md"), "utf-8"),
			).toBe("Agent instructions\n");
			expect(JSON.parse(readFileSync(created.configPath, "utf-8"))).toEqual({
				agents: {
					"agent-railly": {
						telegram: {
							allowedUsers: [2, 1],
							botToken: "token-a",
						},
					},
				},
				autoCompact: true,
				heartbeat: {
					deferMinutes: 0,
					intervalMinutes: 30,
				},
				port: 4000,
			});
			expect(existsSync(join(created.agentHomeDir, ".claude", "skills"))).toBe(
				true,
			);
		} finally {
			rmSync(homeDir, { force: true, recursive: true });
			rmSync(templatesDir, { force: true, recursive: true });
		}
	});

	test("createAgent persists a default cron user when configured", () => {
		const homeDir = createHomeDir();
		const templatesDir = createTemplatesDir();
		try {
			createAgent({
				allowedUsers: [2, 1],
				botToken: "token-a",
				defaultCronUserId: 1,
				homeDir,
				name: "railly",
				templatesDir,
				createAgentId: () => "agent-railly",
			});

			expect(
				JSON.parse(readFileSync(join(homeDir, "config.json"), "utf-8")),
			).toEqual({
				agents: {
					"agent-railly": {
						telegram: {
							allowedUsers: [2, 1],
							botToken: "token-a",
							defaultCronUserId: 1,
						},
					},
				},
				autoCompact: true,
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

	test("createAgent rejects a default cron user outside allowed users", () => {
		const homeDir = createHomeDir();
		const templatesDir = createTemplatesDir();
		try {
			expect(() =>
				createAgent({
					allowedUsers: [1, 2],
					defaultCronUserId: 3,
					homeDir,
					name: "railly",
					templatesDir,
				}),
			).toThrow("Default cron user 3 must be included in allowed users");
		} finally {
			rmSync(homeDir, { force: true, recursive: true });
			rmSync(templatesDir, { force: true, recursive: true });
		}
	});

	test("createAgent seeds the oc skill from the default templates", () => {
		const homeDir = createHomeDir();
		try {
			const created = createAgent({
				homeDir,
				name: "railly",
				templatesDir: REPO_TEMPLATES_DIR,
				createAgentId: () => "agent-railly",
			});

			expect(
				readFileSync(
					join(created.agentHomeDir, "skills", "oc", "SKILL.md"),
					"utf-8",
				),
			).toContain("name: oc");
			expect(
				readFileSync(
					join(
						created.agentHomeDir,
						"skills",
						"oc",
						"references",
						"daemon-operations.md",
					),
					"utf-8",
				),
			).toContain("oc start");
			expect(
				readFileSync(
					join(
						created.agentHomeDir,
						"skills",
						"oc",
						"references",
						"session-lookup.md",
					),
					"utf-8",
				),
			).toContain("oc session transcript <id-or-prefix>");
			expect(
				readFileSync(
					join(
						created.agentHomeDir,
						"skills",
						"oc",
						"references",
						"agent-management.md",
					),
					"utf-8",
				),
			).toContain("oc agent create <name>");
		} finally {
			rmSync(homeDir, { force: true, recursive: true });
		}
	});

	test("createAgent seeds the voice-mode skill package from the default templates", () => {
		const homeDir = createHomeDir();
		try {
			const created = createAgent({
				homeDir,
				name: "railly",
				templatesDir: REPO_TEMPLATES_DIR,
				createAgentId: () => "agent-railly",
			});

			expect(
				readFileSync(
					join(created.agentHomeDir, "skills", "voice-mode", "SKILL.md"),
					"utf-8",
				),
			).toContain("name: voice-mode");
			expect(
				readFileSync(
					join(
						created.agentHomeDir,
						"skills",
						"voice-mode",
						"scripts",
						"transcribe.mjs",
					),
					"utf-8",
				),
			).toContain("GEMINI_API_KEY");
		} finally {
			rmSync(homeDir, { force: true, recursive: true });
		}
	});

	test("createAgent renders the current agent selector into seeded templates", () => {
		const homeDir = createHomeDir();
		try {
			const created = createAgent({
				homeDir,
				name: "railly",
				templatesDir: REPO_TEMPLATES_DIR,
				createAgentId: () => "agent-railly",
			});

			expect(
				readFileSync(join(created.agentHomeDir, "AGENTS.md"), "utf-8"),
			).toContain("~/.outclaw/agents/railly/");
			expect(
				readFileSync(join(created.agentHomeDir, "AGENTS.md"), "utf-8"),
			).not.toContain("<agent-name>");
		} finally {
			rmSync(homeDir, { force: true, recursive: true });
		}
	});

	test("createAgent seeds AGENTS instructions for recalling past context", () => {
		const homeDir = createHomeDir();
		try {
			const created = createAgent({
				homeDir,
				name: "railly",
				templatesDir: REPO_TEMPLATES_DIR,
				createAgentId: () => "agent-railly",
			});

			const agentsTemplate = readFileSync(
				join(created.agentHomeDir, "AGENTS.md"),
				"utf-8",
			);
			expect(agentsTemplate).toContain(
				"Invoke the `oc` skill before proceeding",
			);
			expect(agentsTemplate).toContain("## Recalling Past Context");
			expect(agentsTemplate).toContain("`oc session search`");
			expect(agentsTemplate).toContain("`oc session transcript`");
		} finally {
			rmSync(homeDir, { force: true, recursive: true });
		}
	});

	test("createAgent rejects invalid or duplicate names", () => {
		const homeDir = createHomeDir();
		const templatesDir = createTemplatesDir();
		try {
			expect(() =>
				createAgent({
					homeDir,
					name: "Railly",
					templatesDir,
				}),
			).toThrow("Invalid agent name: Railly");

			createAgent({
				homeDir,
				name: "railly",
				templatesDir,
				createAgentId: () => "agent-railly",
			});
			expect(() =>
				createAgent({
					homeDir,
					name: "railly",
					templatesDir,
				}),
			).toThrow("Agent already exists: railly");
		} finally {
			rmSync(homeDir, { force: true, recursive: true });
			rmSync(templatesDir, { force: true, recursive: true });
		}
	});

	test("renameAgent renames the folder while preserving the agent id", () => {
		const homeDir = createHomeDir();
		try {
			createAgent({
				homeDir,
				name: "railly",
				templatesDir: REPO_TEMPLATES_DIR,
				createAgentId: () => "agent-railly",
			});

			const renamed = renameAgent({
				homeDir,
				newName: "mimi",
				oldName: "railly",
			});

			expect(renamed).toBe(join(homeDir, "agents", "mimi"));
			expect(readAgentId(renamed)).toBe("agent-railly");
			expect(existsSync(join(homeDir, "agents", "railly"))).toBe(false);
			expect(readFileSync(join(renamed, "AGENTS.md"), "utf-8")).toContain(
				"~/.outclaw/agents/mimi/",
			);
			expect(readFileSync(join(renamed, "AGENTS.md"), "utf-8")).not.toContain(
				"~/.outclaw/agents/railly/",
			);
		} finally {
			rmSync(homeDir, { force: true, recursive: true });
		}
	});

	test("removeAgent deletes an agent directory and listAgents returns the remaining selectors", () => {
		const homeDir = createHomeDir();
		const templatesDir = createTemplatesDir();
		try {
			createAgent({
				homeDir,
				name: "railly",
				templatesDir,
				createAgentId: () => "agent-railly",
			});
			createAgent({
				homeDir,
				name: "mimi",
				templatesDir,
				createAgentId: () => "agent-mimi",
			});

			removeAgent({ homeDir, name: "mimi" });

			expect(existsSync(join(homeDir, "agents", "mimi"))).toBe(false);
			expect(
				JSON.parse(readFileSync(join(homeDir, "config.json"), "utf-8")),
			).toEqual({
				agents: {
					"agent-railly": {
						telegram: {
							allowedUsers: [],
							botToken: "",
						},
					},
				},
				autoCompact: true,
				heartbeat: {
					deferMinutes: 0,
					intervalMinutes: 30,
				},
				port: 4000,
			});
			expect(listAgents(homeDir).map((agent) => agent.name)).toEqual([
				"railly",
			]);
		} finally {
			rmSync(homeDir, { force: true, recursive: true });
			rmSync(templatesDir, { force: true, recursive: true });
		}
	});

	test("updateAgent updates telegram config on an existing agent", () => {
		const homeDir = createHomeDir();
		const templatesDir = createTemplatesDir();
		try {
			createAgent({
				homeDir,
				name: "railly",
				templatesDir,
				createAgentId: () => "agent-railly",
				botToken: "token-a",
				allowedUsers: [1, 2],
			});

			updateAgent({
				homeDir,
				name: "railly",
				botToken: "token-b",
				allowedUsers: [3, 4],
				defaultCronUserId: 3,
			});

			const config = JSON.parse(
				readFileSync(join(homeDir, "config.json"), "utf-8"),
			);
			expect(config.agents["agent-railly"].telegram.botToken).toBe("token-b");
			expect(config.agents["agent-railly"].telegram.allowedUsers).toEqual([
				3, 4,
			]);
			expect(config.agents["agent-railly"].telegram.defaultCronUserId).toBe(3);
		} finally {
			rmSync(homeDir, { force: true, recursive: true });
			rmSync(templatesDir, { force: true, recursive: true });
		}
	});

	test("updateAgent does partial update when only one flag is provided", () => {
		const homeDir = createHomeDir();
		const templatesDir = createTemplatesDir();
		try {
			createAgent({
				homeDir,
				name: "railly",
				templatesDir,
				createAgentId: () => "agent-railly",
				botToken: "token-a",
				allowedUsers: [1, 2],
			});

			updateAgent({
				homeDir,
				name: "railly",
				botToken: "token-b",
			});

			const config = JSON.parse(
				readFileSync(join(homeDir, "config.json"), "utf-8"),
			);
			expect(config.agents["agent-railly"].telegram.botToken).toBe("token-b");
			expect(config.agents["agent-railly"].telegram.allowedUsers).toEqual([
				1, 2,
			]);
			expect(config.agents["agent-railly"].telegram.defaultCronUserId).toBe(
				undefined,
			);
		} finally {
			rmSync(homeDir, { force: true, recursive: true });
			rmSync(templatesDir, { force: true, recursive: true });
		}
	});

	test("updateAgent preserves env indirection for secured telegram config", () => {
		const homeDir = createHomeDir();
		const templatesDir = createTemplatesDir();
		try {
			createAgent({
				homeDir,
				name: "railly",
				templatesDir,
				createAgentId: () => "agent-railly",
			});
			writeFileSync(
				join(homeDir, "config.json"),
				JSON.stringify(
					{
						agents: {
							"agent-railly": {
								telegram: {
									botToken: "$RAILLY_TELEGRAM_BOT_TOKEN",
									allowedUsers: "$RAILLY_TELEGRAM_USERS",
									defaultCronUserId: "$RAILLY_DEFAULT_CRON_USER",
								},
							},
						},
					},
					null,
					"\t",
				),
			);
			writeFileSync(
				join(homeDir, ".env"),
				"RAILLY_TELEGRAM_BOT_TOKEN=token-a\nRAILLY_TELEGRAM_USERS=1,2\nRAILLY_DEFAULT_CRON_USER=1\n",
			);

			updateAgent({
				homeDir,
				name: "railly",
				botToken: "token-b",
				allowedUsers: [3, 4],
				defaultCronUserId: 3,
			});

			const config = JSON.parse(
				readFileSync(join(homeDir, "config.json"), "utf-8"),
			);
			expect(config.agents["agent-railly"].telegram.botToken).toBe(
				"$RAILLY_TELEGRAM_BOT_TOKEN",
			);
			expect(config.agents["agent-railly"].telegram.allowedUsers).toBe(
				"$RAILLY_TELEGRAM_USERS",
			);
			expect(config.agents["agent-railly"].telegram.defaultCronUserId).toBe(
				"$RAILLY_DEFAULT_CRON_USER",
			);
			expect(readFileSync(join(homeDir, ".env"), "utf-8")).toContain(
				"RAILLY_TELEGRAM_BOT_TOKEN=token-b",
			);
			expect(readFileSync(join(homeDir, ".env"), "utf-8")).toContain(
				"RAILLY_TELEGRAM_USERS=3,4",
			);
			expect(readFileSync(join(homeDir, ".env"), "utf-8")).toContain(
				"RAILLY_DEFAULT_CRON_USER=3",
			);
		} finally {
			rmSync(homeDir, { force: true, recursive: true });
			rmSync(templatesDir, { force: true, recursive: true });
		}
	});

	test("updateAgent throws when agent does not exist", () => {
		const homeDir = createHomeDir();
		try {
			expect(() =>
				updateAgent({
					homeDir,
					name: "nonexistent",
					botToken: "token-a",
				}),
			).toThrow("Agent does not exist: nonexistent");
		} finally {
			rmSync(homeDir, { force: true, recursive: true });
		}
	});

	test("updateAgent rejects a default cron user outside allowed users", () => {
		const homeDir = createHomeDir();
		const templatesDir = createTemplatesDir();
		try {
			createAgent({
				homeDir,
				name: "railly",
				templatesDir,
				createAgentId: () => "agent-railly",
				allowedUsers: [1, 2],
			});

			expect(() =>
				updateAgent({
					homeDir,
					name: "railly",
					defaultCronUserId: 3,
				}),
			).toThrow("Default cron user 3 must be included in allowed users");
		} finally {
			rmSync(homeDir, { force: true, recursive: true });
			rmSync(templatesDir, { force: true, recursive: true });
		}
	});

	test("removeAgent deletes agent-owned shared persistence", () => {
		const homeDir = createHomeDir();
		try {
			createAgent({
				homeDir,
				name: "railly",
				templatesDir: REPO_TEMPLATES_DIR,
				createAgentId: () => "agent-railly",
			});
			createAgent({
				homeDir,
				name: "mimi",
				templatesDir: REPO_TEMPLATES_DIR,
				createAgentId: () => "agent-mimi",
			});

			const dbPath = join(homeDir, "db.sqlite");
			const globalStore = new SessionStore(dbPath);
			const raillyStore = new SessionStore(dbPath, { agentId: "agent-railly" });
			const mimiStore = new SessionStore(dbPath, { agentId: "agent-mimi" });
			const routeStore = new TelegramRouteStore(dbPath);

			try {
				raillyStore.upsert({
					providerId: "claude",
					sdkSessionId: "sdk-railly",
					title: "Railly chat",
					model: "opus",
				});
				mimiStore.upsert({
					providerId: "claude",
					sdkSessionId: "sdk-mimi",
					title: "Mimi chat",
					model: "haiku",
				});
				mimiStore.setActiveSessionId("claude", "sdk-mimi");
				mimiStore.setLastUserTarget({
					kind: "telegram",
					chatId: 202,
				});
				globalStore.setLastInteractiveAgentId("agent-mimi");
				routeStore.setAgentId("bot-a", 101, "agent-mimi");
				routeStore.setAgentId("bot-a", 202, "agent-railly");

				removeAgent({ homeDir, name: "mimi" });

				expect(mimiStore.get("claude", "sdk-mimi")).toBeUndefined();
				expect(mimiStore.getActiveSessionId("claude")).toBeUndefined();
				expect(mimiStore.getLastUserTarget()).toBeUndefined();
				expect(globalStore.getLastInteractiveAgentId()).toBeUndefined();
				expect(routeStore.getAgentId("bot-a", 101)).toBeUndefined();
				expect(raillyStore.get("claude", "sdk-railly")).toBeDefined();
				expect(routeStore.getAgentId("bot-a", 202)).toBe("agent-railly");
			} finally {
				globalStore.close();
				raillyStore.close();
				mimiStore.close();
				routeStore.close();
			}
		} finally {
			rmSync(homeDir, { force: true, recursive: true });
		}
	});
});
