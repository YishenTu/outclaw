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
			api.readAgentFile("agent-railly", "cron/daily.yaml"),
		).resolves.toEqual({
			content:
				"name: Daily\nschedule: 15 6 * * *\nmodel: haiku\nenabled: true\nprompt: Check inbox\n",
			kind: "text",
			language: "yaml",
			path: "cron/daily.yaml",
			truncated: false,
		});

		await expect(
			api.readAgentFile("agent-railly", "../outside.txt"),
		).rejects.toThrow("Path escapes agent home");

		store.close();
	});

	test("detects common code file languages for browser previews", async () => {
		const root = createTempDir("outclaw-browser-language-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		mkdirSync(agentHomeDir, { recursive: true });
		writeFileSync(join(agentHomeDir, "main.py"), "print('hi')\n");
		writeFileSync(join(agentHomeDir, "lib.rs"), "fn main() {}\n");
		writeFileSync(join(agentHomeDir, "server.go"), "package main\n");
		writeFileSync(join(agentHomeDir, "config.toml"), "port = 4000\n");
		writeFileSync(join(agentHomeDir, "layout.xml"), "<root />\n");
		writeFileSync(join(agentHomeDir, "Dockerfile"), "FROM alpine:latest\n");
		writeFileSync(join(agentHomeDir, "settings.ini"), "[app]\nname=test\n");
		writeFileSync(join(agentHomeDir, "Main.java"), "class Main {}\n");
		writeFileSync(join(agentHomeDir, "main.c"), "int main() { return 0; }\n");
		writeFileSync(join(agentHomeDir, "main.cpp"), "int main() { return 0; }\n");

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
			api.readAgentFile("agent-railly", "main.py"),
		).resolves.toMatchObject({
			kind: "text",
			language: "python",
		});
		await expect(
			api.readAgentFile("agent-railly", "lib.rs"),
		).resolves.toMatchObject({
			kind: "text",
			language: "rust",
		});
		await expect(
			api.readAgentFile("agent-railly", "server.go"),
		).resolves.toMatchObject({
			kind: "text",
			language: "go",
		});
		await expect(
			api.readAgentFile("agent-railly", "config.toml"),
		).resolves.toMatchObject({
			kind: "text",
			language: "toml",
		});
		await expect(
			api.readAgentFile("agent-railly", "layout.xml"),
		).resolves.toMatchObject({
			kind: "text",
			language: "xml",
		});
		await expect(
			api.readAgentFile("agent-railly", "Dockerfile"),
		).resolves.toMatchObject({
			kind: "text",
			language: "dockerfile",
		});
		await expect(
			api.readAgentFile("agent-railly", "settings.ini"),
		).resolves.toMatchObject({
			kind: "text",
			language: "ini",
		});
		await expect(
			api.readAgentFile("agent-railly", "Main.java"),
		).resolves.toMatchObject({
			kind: "text",
			language: "java",
		});
		await expect(
			api.readAgentFile("agent-railly", "main.c"),
		).resolves.toMatchObject({
			kind: "text",
			language: "c",
		});
		await expect(
			api.readAgentFile("agent-railly", "main.cpp"),
		).resolves.toMatchObject({
			kind: "text",
			language: "cpp",
		});

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
