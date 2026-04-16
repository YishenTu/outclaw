import { afterEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBrowserApi } from "../../../src/runtime/browser/create-browser-api.ts";
import { SessionStore } from "../../../src/runtime/persistence/session-store.ts";

function createTempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

describe("createBrowserApi", () => {
	const cleanupPaths: string[] = [];

	afterEach(() => {
		for (const path of cleanupPaths.splice(0)) {
			if (existsSync(path)) {
				rmSync(path, { force: true, recursive: true });
			}
		}
	});

	test("builds sidebar summaries from persisted sessions", () => {
		const root = createTempDir("outclaw-browser-api-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		mkdirSync(agentHomeDir, { recursive: true });

		const store = new SessionStore(dbPath, { agentId: "agent-railly" });
		store.upsert({
			providerId: "claude",
			sdkSessionId: "sdk-1",
			title: "First",
			model: "opus",
		});
		store.setActiveSessionId("claude", "sdk-1");

		const api = createBrowserApi({
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					homeDir: agentHomeDir,
					providerId: "claude",
				},
			],
			getRememberedAgentId: () => "agent-railly",
			gitRoot: root,
			storesByAgent: new Map([["agent-railly", store]]),
		});

		expect(api.listAgents()).toEqual({
			activeAgentId: "agent-railly",
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					activeSession: {
						providerId: "claude",
						sdkSessionId: "sdk-1",
					},
					sessions: [
						{
							providerId: "claude",
							sdkSessionId: "sdk-1",
							title: "First",
							model: "opus",
							lastActive: expect.any(Number),
						},
					],
				},
			],
		});

		store.close();
	});

	test("reads agent files and lists the agent tree", async () => {
		const root = createTempDir("outclaw-browser-files-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		const cronDir = join(agentHomeDir, "cron");
		mkdirSync(cronDir, { recursive: true });
		writeFileSync(join(agentHomeDir, "AGENTS.md"), "# Agent\n");
		writeFileSync(
			join(cronDir, "daily.yaml"),
			"name: Daily\nschedule: 15 6 * * *\nmodel: haiku\nenabled: true\nprompt: Check inbox\n",
		);

		const store = new SessionStore(dbPath, { agentId: "agent-railly" });
		const api = createBrowserApi({
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					homeDir: agentHomeDir,
					providerId: "claude",
				},
			],
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			storesByAgent: new Map([["agent-railly", store]]),
		});

		await expect(api.listAgentTree("agent-railly")).resolves.toEqual([
			{
				children: [
					{
						kind: "file",
						name: "daily.yaml",
						path: "cron/daily.yaml",
					},
				],
				kind: "directory",
				name: "cron",
				path: "cron",
			},
			{
				kind: "file",
				name: "AGENTS.md",
				path: "AGENTS.md",
			},
		]);

		await expect(api.listAgentCron("agent-railly")).resolves.toEqual([
			{
				name: "Daily",
				path: "cron/daily.yaml",
				schedule: "15 6 * * *",
				model: "haiku",
				enabled: true,
			},
		]);

		await expect(
			api.readAgentFile("agent-railly", "AGENTS.md"),
		).resolves.toEqual({
			content: "# Agent\n",
			kind: "text",
			language: "markdown",
			path: "AGENTS.md",
			truncated: false,
		});

		await expect(
			api.readAgentFile("agent-railly", "../outside.txt"),
		).rejects.toThrow("Path escapes agent home");

		store.close();
	});

	test("reads git status with a graph summary", async () => {
		const root = createTempDir("outclaw-browser-git-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		mkdirSync(agentHomeDir, { recursive: true });

		runGit(root, ["init", "--initial-branch=main"]);
		runGit(root, ["config", "user.email", "test@example.com"]);
		runGit(root, ["config", "user.name", "Test User"]);
		writeFileSync(join(root, "README.md"), "first\n");
		runGit(root, ["add", "README.md"]);
		runGit(root, ["commit", "-m", "Initial commit"]);
		writeFileSync(join(root, "README.md"), "second\n");
		runGit(root, ["add", "README.md"]);
		runGit(root, ["commit", "-m", "Second commit"]);

		const store = new SessionStore(dbPath, { agentId: "agent-railly" });
		const api = createBrowserApi({
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					homeDir: agentHomeDir,
					providerId: "claude",
				},
			],
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			storesByAgent: new Map([["agent-railly", store]]),
		});

		const status = await api.readGitStatus();
		expect(status.branch).toBe("main");
		expect(status.graph).toContain("Second commit");
		expect(status.graph).toContain("Initial commit");

		store.close();
	});

	test("updates cron enabled state and persists it to the config file", async () => {
		const root = createTempDir("outclaw-browser-cron-toggle-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		const cronDir = join(agentHomeDir, "cron");
		mkdirSync(cronDir, { recursive: true });
		const cronPath = join(cronDir, "daily.yaml");
		writeFileSync(
			cronPath,
			"name: Daily\nschedule: 15 6 * * *\nmodel: haiku\nenabled: true\nprompt: Check inbox\n",
		);

		const store = new SessionStore(dbPath, { agentId: "agent-railly" });
		const api = createBrowserApi({
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					homeDir: agentHomeDir,
					providerId: "claude",
				},
			],
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			storesByAgent: new Map([["agent-railly", store]]),
		});

		await expect(
			api.setAgentCronEnabled("agent-railly", "cron/daily.yaml", false),
		).resolves.toEqual({
			name: "Daily",
			path: "cron/daily.yaml",
			schedule: "15 6 * * *",
			model: "haiku",
			enabled: false,
		});

		await expect(api.listAgentCron("agent-railly")).resolves.toEqual([
			{
				name: "Daily",
				path: "cron/daily.yaml",
				schedule: "15 6 * * *",
				model: "haiku",
				enabled: false,
			},
		]);

		store.close();
	});
});

function runGit(cwd: string, args: string[]) {
	const result = Bun.spawnSync(["git", ...args], {
		cwd,
		stderr: "pipe",
		stdout: "pipe",
	});
	if (result.exitCode !== 0) {
		throw new Error(result.stderr.toString().trim() || "git command failed");
	}
}
