import { afterEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBrowserApi } from "../../../src/runtime/browser/create-browser-api.ts";
import { SessionStore } from "../../../src/runtime/persistence/session-store/session-store.ts";

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
					terminalRunCommand: "",
				},
			],
			getRememberedAgentId: () => "agent-railly",
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map([["agent-railly", store]]),
		});

		expect(api.listAgents()).toEqual({
			activeAgentId: "agent-railly",
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					terminalRunCommand: "",
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

	test("sorts sidebar agents by name while preserving provider active sessions", () => {
		const root = createTempDir("outclaw-browser-api-sort-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const alphaHomeDir = join(root, "agents", "alpha");
		const betaHomeDir = join(root, "agents", "beta");
		mkdirSync(alphaHomeDir, { recursive: true });
		mkdirSync(betaHomeDir, { recursive: true });

		const alphaStore = new SessionStore(dbPath, { agentId: "agent-alpha" });
		const betaStore = new SessionStore(dbPath, { agentId: "agent-beta" });
		betaStore.upsert({
			providerId: "claude",
			sdkSessionId: "sdk-beta",
			title: "Beta active",
			model: "opus",
		});
		betaStore.setActiveSessionId("claude", "sdk-beta");

		const api = createBrowserApi({
			agents: [
				{
					agentId: "agent-beta",
					name: "beta",
					homeDir: betaHomeDir,
					providerId: "claude",
					terminalRunCommand: "",
				},
				{
					agentId: "agent-alpha",
					name: "alpha",
					homeDir: alphaHomeDir,
					providerId: "mock",
					terminalRunCommand: "",
				},
			],
			getRememberedAgentId: () => "agent-beta",
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map([
				["agent-alpha", alphaStore],
				["agent-beta", betaStore],
			]),
		});

		expect(api.listAgents().agents.map((agent) => agent.name)).toEqual([
			"alpha",
			"beta",
		]);
		expect(api.listAgents().agents[1]?.activeSession).toEqual({
			providerId: "claude",
			sdkSessionId: "sdk-beta",
		});

		alphaStore.close();
		betaStore.close();
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
			"name: Daily\nschedule: 15 6 * * *\nmodel: haiku\neffort: high\nenabled: true\nprompt: Check inbox\n",
		);

		const store = new SessionStore(dbPath, { agentId: "agent-railly" });
		const api = createBrowserApi({
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					homeDir: agentHomeDir,
					providerId: "claude",
					terminalRunCommand: "",
				},
			],
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
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
				scheduleKind: "recurring",
				status: "scheduled",
				model: "haiku",
				effort: "high",
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
				"name: Daily\nschedule: 15 6 * * *\nmodel: haiku\neffort: high\nenabled: true\nprompt: Check inbox\n",
			kind: "text",
			language: "yaml",
			path: "cron/daily.yaml",
			truncated: false,
		});

		await expect(
			api.readAgentFile("agent-railly", "../outside.txt"),
		).rejects.toThrow("Path escapes agent home");
		await expect(
			api.setAgentCronEnabled("agent-railly", "AGENTS.md", false),
		).rejects.toThrow("Path escapes cron directory");

		store.close();
	});

	test("lists cron history for a job, newest first, with hasMore paging", async () => {
		const root = createTempDir("outclaw-browser-cron-history-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		mkdirSync(agentHomeDir, { recursive: true });

		const store = new SessionStore(dbPath, { agentId: "agent-railly" });
		for (let index = 1; index <= 3; index++) {
			const sdkSessionId = `cron-${index}`;
			store.upsert({
				providerId: "claude",
				sdkSessionId,
				title: "daily-report",
				model: "opus",
				tag: "cron",
			});
		}
		const { Database } = await import("bun:sqlite");
		const db = new Database(dbPath);
		for (let index = 1; index <= 3; index++) {
			db.query(
				`UPDATE sessions SET last_active = $ts
				 WHERE agent_id = 'agent-railly' AND sdk_session_id = $id`,
			).run({ $ts: index * 1000, $id: `cron-${index}` });
		}
		db.close();

		const api = createBrowserApi({
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					homeDir: agentHomeDir,
					providerId: "claude",
					terminalRunCommand: "",
				},
			],
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			readTranscriptsByAgent: new Map([
				[
					"agent-railly",
					async (sessionId) => [
						{
							role: "assistant",
							content: `result ${sessionId.slice("cron-".length)}`,
							timestamp: 100,
						},
					],
				],
			]),
			storesByAgent: new Map([["agent-railly", store]]),
		});

		const firstPage = await api.listAgentCronHistory("agent-railly", {
			jobName: "daily-report",
			limit: 1,
		});
		expect(firstPage).toEqual({
			entries: [
				{
					providerId: "claude",
					sessionId: "cron-3",
					ranAt: 3000,
					resultText: "result 3",
				},
			],
			hasMore: true,
		});

		const secondPage = await api.listAgentCronHistory("agent-railly", {
			jobName: "daily-report",
			limit: 3,
			before: firstPage.entries.at(-1),
		});
		expect(secondPage).toEqual({
			entries: [
				{
					providerId: "claude",
					sessionId: "cron-2",
					ranAt: 2000,
					resultText: "result 2",
				},
				{
					providerId: "claude",
					sessionId: "cron-1",
					ranAt: 1000,
					resultText: "result 1",
				},
			],
			hasMore: false,
		});

		store.close();
	});

	test("hydrates cron history output from the agent transcript reader without mutating the index", async () => {
		const root = createTempDir("outclaw-browser-cron-history-hydrate-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		mkdirSync(agentHomeDir, { recursive: true });

		const store = new SessionStore(dbPath, { agentId: "agent-railly" });
		store.upsert({
			providerId: "claude",
			sdkSessionId: "cron-empty-index",
			title: "daily-report",
			model: "opus",
			tag: "cron",
			timestamp: 1000,
		});

		const api = createBrowserApi({
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					homeDir: agentHomeDir,
					providerId: "claude",
					terminalRunCommand: "",
				},
			],
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			readTranscriptsByAgent: new Map([
				[
					"agent-railly",
					async (sessionId) => {
						expect(sessionId).toBe("cron-empty-index");
						return [
							{
								role: "user",
								content: "scheduled prompt",
								timestamp: 1000,
							},
							{
								role: "assistant",
								content: "Recovered cron output",
								timestamp: 1001,
							},
						];
					},
				],
			]),
			storesByAgent: new Map([["agent-railly", store]]),
		});

		await expect(
			api.listAgentCronHistory("agent-railly", {
				jobName: "daily-report",
				limit: 1,
			}),
		).resolves.toEqual({
			entries: [
				{
					providerId: "claude",
					sessionId: "cron-empty-index",
					ranAt: 1000,
					resultText: "Recovered cron output",
				},
			],
			hasMore: false,
		});
		expect(store.listCronRunsByTitle("daily-report", { limit: 1 })).toEqual([
			{
				providerId: "claude",
				sessionId: "cron-empty-index",
				ranAt: 1000,
				resultText: "",
			},
		]);

		store.close();
	});

	test("lists pending inbox files and archived inbox files", async () => {
		const root = createTempDir("outclaw-browser-inbox-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		const inboxDir = join(agentHomeDir, "inbox");
		const archiveDir = join(inboxDir, "archive");
		mkdirSync(archiveDir, { recursive: true });

		const olderPath = join(inboxDir, "older.md");
		const newerPath = join(inboxDir, "newer.md");
		const archivedPath = join(archiveDir, "done.md");
		writeFileSync(olderPath, "older");
		writeFileSync(newerPath, "newer");
		writeFileSync(archivedPath, "done");
		writeFileSync(join(inboxDir, ".DS_Store"), "");
		writeFileSync(join(inboxDir, ".gitkeep"), "");
		writeFileSync(join(archiveDir, ".DS_Store"), "");
		writeFileSync(join(archiveDir, ".gitkeep"), "");
		utimesSync(
			olderPath,
			new Date("2026-04-01T00:00:00.000Z"),
			new Date("2026-04-01T00:00:00.000Z"),
		);
		utimesSync(
			newerPath,
			new Date("2026-04-02T00:00:00.000Z"),
			new Date("2026-04-02T00:00:00.000Z"),
		);
		utimesSync(
			archivedPath,
			new Date("2026-04-03T00:00:00.000Z"),
			new Date("2026-04-03T00:00:00.000Z"),
		);

		const store = new SessionStore(dbPath, { agentId: "agent-railly" });
		const api = createBrowserApi({
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					homeDir: agentHomeDir,
					providerId: "claude",
					terminalRunCommand: "",
				},
			],
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map([["agent-railly", store]]),
		});

		await expect(api.listAgentInbox("agent-railly")).resolves.toEqual({
			archivedItems: [
				{
					location: "archive",
					modifiedAt: "2026-04-03T00:00:00.000Z",
					name: "done.md",
					path: "inbox/archive/done.md",
					size: 4,
				},
			],
			items: [
				{
					location: "inbox",
					modifiedAt: "2026-04-02T00:00:00.000Z",
					name: "newer.md",
					path: "inbox/newer.md",
					size: 5,
				},
				{
					location: "inbox",
					modifiedAt: "2026-04-01T00:00:00.000Z",
					name: "older.md",
					path: "inbox/older.md",
					size: 5,
				},
			],
			pendingCount: 2,
		});

		store.close();
	});

	test("archives inbox files without overwriting and restores them for undo", async () => {
		const root = createTempDir("outclaw-browser-inbox-archive-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		const inboxDir = join(agentHomeDir, "inbox");
		const archiveDir = join(inboxDir, "archive");
		mkdirSync(archiveDir, { recursive: true });
		writeFileSync(join(inboxDir, "todo.md"), "todo");
		writeFileSync(join(archiveDir, "todo.md"), "existing archive");

		const store = new SessionStore(dbPath, { agentId: "agent-railly" });
		const api = createBrowserApi({
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					homeDir: agentHomeDir,
					providerId: "claude",
					terminalRunCommand: "",
				},
			],
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map([["agent-railly", store]]),
		});

		await expect(
			api.archiveAgentInboxItem("agent-railly", "inbox/todo.md"),
		).resolves.toMatchObject({
			archivedPath: "inbox/archive/todo-1.md",
			item: {
				location: "archive",
				name: "todo-1.md",
				path: "inbox/archive/todo-1.md",
				size: 4,
			},
			originalPath: "inbox/todo.md",
		});
		expect(existsSync(join(inboxDir, "todo.md"))).toBe(false);
		expect(readFileSync(join(archiveDir, "todo.md"), "utf8")).toBe(
			"existing archive",
		);
		expect(readFileSync(join(archiveDir, "todo-1.md"), "utf8")).toBe("todo");

		await expect(
			api.restoreAgentInboxItem(
				"agent-railly",
				"inbox/archive/todo-1.md",
				"inbox/todo.md",
			),
		).resolves.toMatchObject({
			archivedPath: "inbox/archive/todo-1.md",
			item: {
				location: "inbox",
				name: "todo.md",
				path: "inbox/todo.md",
				size: 4,
			},
			restoredPath: "inbox/todo.md",
		});
		expect(readFileSync(join(inboxDir, "todo.md"), "utf8")).toBe("todo");
		expect(existsSync(join(archiveDir, "todo-1.md"))).toBe(false);

		store.close();
	});

	test("creates inbox notes from quick text without timestamped filenames", async () => {
		const root = createTempDir("outclaw-browser-inbox-note-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		const inboxDir = join(agentHomeDir, "inbox");
		mkdirSync(inboxDir, { recursive: true });
		writeFileSync(join(inboxDir, "follow-up.md"), "existing");

		const store = new SessionStore(dbPath, { agentId: "agent-railly" });
		const api = createBrowserApi({
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					homeDir: agentHomeDir,
					providerId: "claude",
					terminalRunCommand: "",
				},
			],
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map([["agent-railly", store]]),
		});

		await expect(
			api.createAgentInboxNote("agent-railly", {
				body: "Check the customer report.",
				title: "Follow Up",
			}),
		).resolves.toMatchObject({
			item: {
				location: "inbox",
				name: "follow-up-1.md",
				path: "inbox/follow-up-1.md",
			},
			path: "inbox/follow-up-1.md",
		});
		expect(readFileSync(join(inboxDir, "follow-up-1.md"), "utf8")).toBe(
			"# Follow Up\n\nCheck the customer report.\n",
		);

		await expect(
			api.createAgentInboxNote("agent-railly", {
				body: "Untitled body",
				title: "",
			}),
		).resolves.toMatchObject({
			item: {
				location: "inbox",
				name: "inbox-note.md",
				path: "inbox/inbox-note.md",
			},
			path: "inbox/inbox-note.md",
		});
		expect(readFileSync(join(inboxDir, "inbox-note.md"), "utf8")).toBe(
			"# Inbox note\n\nUntitled body\n",
		);

		store.close();
	});

	test("rejects agent file symlinks that resolve outside the agent home", async () => {
		const root = createTempDir("outclaw-browser-file-symlink-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		const outsideDir = join(root, "outside");
		mkdirSync(agentHomeDir, { recursive: true });
		mkdirSync(outsideDir, { recursive: true });
		writeFileSync(join(outsideDir, "secret.txt"), "secret\n");
		symlinkSync(join(outsideDir, "secret.txt"), join(agentHomeDir, "link.txt"));

		const store = new SessionStore(dbPath, { agentId: "agent-railly" });
		const api = createBrowserApi({
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					homeDir: agentHomeDir,
					providerId: "claude",
					terminalRunCommand: "",
				},
			],
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map([["agent-railly", store]]),
		});

		await expect(api.readAgentFile("agent-railly", "link.txt")).rejects.toThrow(
			"Path escapes agent home",
		);

		store.close();
	});

	test("rejects cron mutation symlinks that resolve outside the cron directory", async () => {
		const root = createTempDir("outclaw-browser-cron-symlink-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		const cronDir = join(agentHomeDir, "cron");
		const outsideDir = join(root, "outside");
		const outsideCronFile = join(outsideDir, "daily.yaml");
		mkdirSync(cronDir, { recursive: true });
		mkdirSync(outsideDir, { recursive: true });
		writeFileSync(
			outsideCronFile,
			"name: Daily\nschedule: 15 6 * * *\nenabled: true\nprompt: Check inbox\n",
		);
		symlinkSync(outsideCronFile, join(cronDir, "daily.yaml"));

		const store = new SessionStore(dbPath, { agentId: "agent-railly" });
		const api = createBrowserApi({
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					homeDir: agentHomeDir,
					providerId: "claude",
					terminalRunCommand: "",
				},
			],
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map([["agent-railly", store]]),
		});

		await expect(
			api.setAgentCronEnabled("agent-railly", "cron/daily.yaml", false),
		).rejects.toThrow("Path escapes cron directory");
		expect(readFileSync(outsideCronFile, "utf-8")).toContain("enabled: true");

		store.close();
	});

	test("reads the runtime root config file", async () => {
		const root = createTempDir("outclaw-browser-config-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		mkdirSync(agentHomeDir, { recursive: true });
		writeFileSync(
			join(root, "config.json"),
			'{\n\t"host": "127.0.0.1",\n\t"port": 4000\n}\n',
		);

		const store = new SessionStore(dbPath, { agentId: "agent-railly" });
		const api = createBrowserApi({
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					homeDir: agentHomeDir,
					providerId: "claude",
					terminalRunCommand: "",
				},
			],
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map([["agent-railly", store]]),
		});

		await expect(api.readConfigFile()).resolves.toEqual({
			content: '{\n\t"host": "127.0.0.1",\n\t"port": 4000\n}\n',
			kind: "text",
			language: "json",
			path: "config.json",
			schema: expect.objectContaining({
				kind: "object",
				properties: expect.objectContaining({
					port: {
						editorKinds: ["number"],
						kind: "leaf",
						typeLabel: "number",
					},
				}),
			}),
			truncated: false,
		});

		store.close();
	});

	test("writes the runtime root config file", async () => {
		const root = createTempDir("outclaw-browser-config-write-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		mkdirSync(agentHomeDir, { recursive: true });
		writeFileSync(join(root, "config.json"), '{\n\t"port": 4000\n}\n');

		const store = new SessionStore(dbPath, { agentId: "agent-railly" });
		const api = createBrowserApi({
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					homeDir: agentHomeDir,
					providerId: "claude",
					terminalRunCommand: "",
				},
			],
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map([["agent-railly", store]]),
		});

		await expect(
			api.writeConfigFile({
				host: "127.0.0.1",
				port: 4100,
			}),
		).resolves.toEqual({
			content: '{\n\t"host": "127.0.0.1",\n\t"port": 4100\n}\n',
			kind: "text",
			language: "json",
			path: "config.json",
			schema: expect.objectContaining({
				kind: "object",
				properties: expect.objectContaining({
					agents: expect.objectContaining({
						additionalProperties: expect.objectContaining({
							properties: expect.objectContaining({
								telegram: expect.objectContaining({
									properties: expect.objectContaining({
										allowedUsers: {
											editorKinds: ["array", "string"],
											kind: "leaf",
											stringFormat: "env_ref",
											typeLabel: "number[] | string",
										},
									}),
								}),
							}),
						}),
					}),
				}),
			}),
			truncated: false,
		});
		expect(readFileSync(join(root, "config.json"), "utf-8")).toBe(
			'{\n\t"host": "127.0.0.1",\n\t"port": 4100\n}\n',
		);

		store.close();
	});

	test("writes the per-agent terminal run command without mutating the runtime snapshot", async () => {
		const root = createTempDir("outclaw-browser-run-command-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		mkdirSync(agentHomeDir, { recursive: true });
		writeFileSync(
			join(root, "config.json"),
			JSON.stringify(
				{
					agents: {
						"agent-railly": {
							terminal: {
								runCommand: "bun test",
							},
						},
					},
				},
				null,
				"\t",
			),
		);

		const store = new SessionStore(dbPath, { agentId: "agent-railly" });
		const api = createBrowserApi({
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					homeDir: agentHomeDir,
					providerId: "claude",
					terminalRunCommand: "bun test",
				},
			],
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map([["agent-railly", store]]),
		});

		expect(api.listAgents().agents[0]?.terminalRunCommand).toBe("bun test");
		await expect(
			api.writeAgentTerminalRunCommand("agent-railly", "  bun run check  "),
		).resolves.toEqual({
			command: "bun test",
		});
		expect(api.listAgents().agents[0]?.terminalRunCommand).toBe("bun test");
		expect(
			JSON.parse(readFileSync(join(root, "config.json"), "utf-8")),
		).toMatchObject({
			agents: {
				"agent-railly": {
					terminal: {
						runCommand: "bun run check",
					},
				},
			},
		});

		store.close();
	});

	test("keeps the terminal run command tied to the running runtime snapshot", async () => {
		const root = createTempDir("outclaw-browser-run-command-snapshot-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		mkdirSync(agentHomeDir, { recursive: true });
		writeFileSync(
			join(root, "config.json"),
			JSON.stringify(
				{
					agents: {
						"agent-railly": {
							terminal: {
								runCommand: "bun test",
							},
						},
					},
				},
				null,
				"\t",
			),
		);

		const store = new SessionStore(dbPath, { agentId: "agent-railly" });
		const api = createBrowserApi({
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					homeDir: agentHomeDir,
					providerId: "claude",
					terminalRunCommand: "bun test",
				},
			],
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map([["agent-railly", store]]),
		});

		writeFileSync(
			join(root, "config.json"),
			JSON.stringify(
				{
					agents: {
						"agent-railly": {
							terminal: {},
						},
					},
				},
				null,
				"\t",
			),
		);

		expect(api.listAgents().agents[0]?.terminalRunCommand).toBe("bun test");

		const restartedAfterExternalEditApi = createBrowserApi({
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					homeDir: agentHomeDir,
					providerId: "claude",
					terminalRunCommand: "",
				},
			],
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map([["agent-railly", store]]),
		});
		expect(
			restartedAfterExternalEditApi.listAgents().agents[0]?.terminalRunCommand,
		).toBe("");

		await expect(
			api.writeAgentTerminalRunCommand("agent-railly", "bun run check"),
		).resolves.toEqual({
			command: "bun test",
		});
		expect(api.listAgents().agents[0]?.terminalRunCommand).toBe("bun test");

		const restartedApi = createBrowserApi({
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					homeDir: agentHomeDir,
					providerId: "claude",
					terminalRunCommand: "bun run check",
				},
			],
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map([["agent-railly", store]]),
		});
		expect(restartedApi.listAgents().agents[0]?.terminalRunCommand).toBe(
			"bun run check",
		);

		store.close();
	});

	test("stores uploaded browser prompt images under the managed files root", async () => {
		const root = createTempDir("outclaw-browser-upload-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		const filesRoot = join(root, "files");
		mkdirSync(agentHomeDir, { recursive: true });

		const store = new SessionStore(dbPath, { agentId: "agent-railly" });
		const api = createBrowserApi({
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					homeDir: agentHomeDir,
					providerId: "claude",
					terminalRunCommand: "",
				},
			],
			filesRoot,
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map([["agent-railly", store]]),
		});

		const uploaded = await api.uploadImages([
			{
				bytes: new Uint8Array([1, 2, 3]),
				mediaType: "image/png",
			},
		]);

		expect(uploaded).toHaveLength(1);
		expect(uploaded[0]).toEqual({
			path: expect.stringMatching(/\.png$/),
			mediaType: "image/png",
		});
		expect(uploaded[0]?.path.startsWith(filesRoot)).toBe(true);
		expect(readFileSync(uploaded[0]?.path ?? "")).toEqual(
			Buffer.from([1, 2, 3]),
		);

		store.close();
	});

	test("lists agent tree entries with git status for modified and new files", async () => {
		const root = createTempDir("outclaw-browser-tree-git-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		const cronDir = join(agentHomeDir, "cron");
		const notesDir = join(agentHomeDir, "notes");
		mkdirSync(cronDir, { recursive: true });
		runGit(root, ["init", "--initial-branch=main"]);
		runGit(root, ["config", "user.email", "test@example.com"]);
		runGit(root, ["config", "user.name", "Test User"]);
		writeFileSync(join(agentHomeDir, "AGENTS.md"), "# Agent\n");
		writeFileSync(
			join(cronDir, "daily.yaml"),
			"name: Daily\nschedule: 15 6 * * *\nprompt: Check inbox\n",
		);
		runGit(root, [
			"add",
			"agents/railly/AGENTS.md",
			"agents/railly/cron/daily.yaml",
		]);
		runGit(root, ["commit", "-m", "Seed agent files"]);

		writeFileSync(join(agentHomeDir, "AGENTS.md"), "# Agent\nUpdated\n");
		mkdirSync(notesDir, { recursive: true });
		writeFileSync(join(notesDir, "todo.md"), "- follow up\n");

		const store = new SessionStore(dbPath, { agentId: "agent-railly" });
		const api = createBrowserApi({
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					homeDir: agentHomeDir,
					providerId: "claude",
					terminalRunCommand: "",
				},
			],
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
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
				children: [
					{
						gitStatus: "new",
						kind: "file",
						name: "todo.md",
						path: "notes/todo.md",
					},
				],
				gitStatus: "new",
				kind: "directory",
				name: "notes",
				path: "notes",
			},
			{
				gitStatus: "modified",
				kind: "file",
				name: "AGENTS.md",
				path: "AGENTS.md",
			},
		]);

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
					terminalRunCommand: "",
				},
			],
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
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

	test("reads git status with structured commit graph data", async () => {
		const root = createTempDir("outclaw-browser-git-");
		cleanupPaths.push(root);

		const previousGitAuthorName = process.env.GIT_AUTHOR_NAME;
		const previousGitAuthorEmail = process.env.GIT_AUTHOR_EMAIL;
		const previousGitCommitterName = process.env.GIT_COMMITTER_NAME;
		const previousGitCommitterEmail = process.env.GIT_COMMITTER_EMAIL;
		process.env.GIT_AUTHOR_NAME = "Hook User";
		process.env.GIT_AUTHOR_EMAIL = "hook@example.com";
		process.env.GIT_COMMITTER_NAME = "Hook User";
		process.env.GIT_COMMITTER_EMAIL = "hook@example.com";

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		let store: SessionStore | undefined;
		try {
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

			store = new SessionStore(dbPath, { agentId: "agent-railly" });
			const api = createBrowserApi({
				agents: [
					{
						agentId: "agent-railly",
						name: "railly",
						homeDir: agentHomeDir,
						providerId: "claude",
						terminalRunCommand: "",
					},
				],
				getRememberedAgentId: () => undefined,
				gitRoot: root,
				homeDir: root,
				storesByAgent: new Map([["agent-railly", store]]),
			});

			const status = await api.readGitStatus();
			if (!status.initialized) {
				throw new Error("expected initialized git status");
			}
			expect(status.branch).toBe("main");
			const secondCommit = status.graph.commits.find(
				(commit) => commit.commit.message === "Second commit",
			);
			expect(secondCommit).toBeDefined();
			expect(secondCommit?.commit.author.name).toBe("Test User");
			expect(secondCommit?.parents.length).toBe(1);
			expect(secondCommit?.parents[0]?.sha.length).toBeGreaterThan(0);

			const initialCommit = status.graph.commits.find(
				(commit) => commit.commit.message === "Initial commit",
			);
			expect(initialCommit).toBeDefined();
			expect(initialCommit?.parents).toEqual([]);

			const mainHead = status.graph.branchHeads.find(
				(head) => head.name === "main",
			);
			expect(mainHead).toBeDefined();
			expect(mainHead?.commit.sha.length).toBeGreaterThan(0);
		} finally {
			store?.close();
			restoreProcessEnvValue("GIT_AUTHOR_NAME", previousGitAuthorName);
			restoreProcessEnvValue("GIT_AUTHOR_EMAIL", previousGitAuthorEmail);
			restoreProcessEnvValue("GIT_COMMITTER_NAME", previousGitCommitterName);
			restoreProcessEnvValue("GIT_COMMITTER_EMAIL", previousGitCommitterEmail);
		}
	});

	test("reads full commit details and patch by sha", async () => {
		const root = createTempDir("outclaw-browser-git-commit-");
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
		writeFileSync(join(root, "README.md"), "second\nthird\n");
		runGit(root, ["add", "README.md"]);
		runGit(root, [
			"commit",
			"-m",
			"Second commit",
			"-m",
			"Explain the new changes.",
		]);

		const store = new SessionStore(dbPath, { agentId: "agent-railly" });
		const api = createBrowserApi({
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					homeDir: agentHomeDir,
					providerId: "claude",
					terminalRunCommand: "",
				},
			],
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map([["agent-railly", store]]),
		});

		const sha = runGit(root, ["rev-parse", "HEAD"]).trim();
		await expect(api.readGitCommit(sha)).resolves.toEqual({
			sha,
			author: {
				name: "Test User",
				email: "test@example.com",
				date: expect.any(String),
			},
			message: "Second commit\n\nExplain the new changes.",
			parents: [
				{
					sha: expect.any(String),
				},
			],
			diff: expect.stringContaining("diff --git a/README.md b/README.md"),
		});
		await expect(api.readGitDiff("../outside.md")).rejects.toThrow(
			"Path escapes agent home",
		);

		store.close();
	});

	test("reads git status with per-file line change counts", async () => {
		const root = createTempDir("outclaw-browser-git-counts-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		mkdirSync(agentHomeDir, { recursive: true });

		runGit(root, ["init", "--initial-branch=main"]);
		runGit(root, ["config", "user.email", "test@example.com"]);
		runGit(root, ["config", "user.name", "Test User"]);
		writeFileSync(join(root, "tracked.txt"), "one\ntwo\nthree\n");
		writeFileSync(join(root, "deleted.txt"), "old\nline\nhere\n");
		runGit(root, ["add", "tracked.txt", "deleted.txt"]);
		runGit(root, ["commit", "-m", "Initial commit"]);

		writeFileSync(join(root, "tracked.txt"), "one\ntwo updated\nthree\nfour\n");
		rmSync(join(root, "deleted.txt"));
		writeFileSync(join(root, "new.txt"), "alpha\nbeta\n");

		const store = new SessionStore(dbPath, { agentId: "agent-railly" });
		const api = createBrowserApi({
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					homeDir: agentHomeDir,
					providerId: "claude",
					terminalRunCommand: "",
				},
			],
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map([["agent-railly", store]]),
		});

		const status = await api.readGitStatus();
		if (!status.initialized) {
			throw new Error("expected initialized git status");
		}
		expect(status.files).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: "tracked.txt",
					additions: 2,
					deletions: 1,
				}),
				expect.objectContaining({
					path: "deleted.txt",
					additions: 0,
					deletions: 3,
				}),
				expect.objectContaining({
					path: "new.txt",
					additions: 2,
					deletions: 0,
				}),
			]),
		);

		store.close();
	});

	test("reads untracked files instead of collapsing them into directories", async () => {
		const root = createTempDir("outclaw-browser-git-untracked-");
		cleanupPaths.push(root);

		const agentHomeDir = join(root, "agents", "railly");
		const newDir = join(root, "notes");
		mkdirSync(agentHomeDir, { recursive: true });
		mkdirSync(newDir, { recursive: true });

		runGit(root, ["init", "--initial-branch=main"]);
		runGit(root, ["config", "user.email", "test@example.com"]);
		runGit(root, ["config", "user.name", "Test User"]);
		writeFileSync(join(root, "README.md"), "seed\n");
		runGit(root, ["add", "README.md"]);
		runGit(root, ["commit", "-m", "Initial commit"]);

		writeFileSync(join(newDir, "todo.md"), "- follow up\n");

		const api = createBrowserApi({
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					homeDir: agentHomeDir,
					providerId: "claude",
					terminalRunCommand: "",
				},
			],
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map(),
		});

		const status = await api.readGitStatus();
		if (!status.initialized) {
			throw new Error("expected initialized git status");
		}
		expect(status.files).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: "notes/todo.md",
				}),
			]),
		);
		expect(status.files).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: "notes/",
				}),
			]),
		);
	});

	test("does not follow untracked symlinks outside the git root for line counts", async () => {
		const root = createTempDir("outclaw-browser-git-symlink-counts-");
		cleanupPaths.push(root);
		const outsideDir = join(root, "..", "outclaw-browser-git-symlink-outside");
		mkdirSync(outsideDir, { recursive: true });
		cleanupPaths.push(outsideDir);

		const agentHomeDir = join(root, "agents", "railly");
		mkdirSync(agentHomeDir, { recursive: true });
		writeFileSync(join(outsideDir, "secret.txt"), "secret\ncontent\n");

		runGit(root, ["init", "--initial-branch=main"]);
		runGit(root, ["config", "user.email", "test@example.com"]);
		runGit(root, ["config", "user.name", "Test User"]);
		writeFileSync(join(root, "README.md"), "seed\n");
		runGit(root, ["add", "README.md"]);
		runGit(root, ["commit", "-m", "Initial commit"]);

		symlinkSync(join(outsideDir, "secret.txt"), join(root, "link.txt"));

		const api = createBrowserApi({
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					homeDir: agentHomeDir,
					providerId: "claude",
					terminalRunCommand: "",
				},
			],
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map(),
		});

		const status = await api.readGitStatus();
		if (!status.initialized) {
			throw new Error("expected initialized git status");
		}
		expect(status.files).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: "link.txt",
					additions: 0,
					deletions: 0,
				}),
			]),
		);
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
			"name: Daily\nschedule: 15 6 * * *\ntimezone: UTC\nmodel: haiku\nenabled: true\nprompt: Check inbox\n",
		);

		const store = new SessionStore(dbPath, { agentId: "agent-railly" });
		const api = createBrowserApi({
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					homeDir: agentHomeDir,
					providerId: "claude",
					terminalRunCommand: "",
				},
			],
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map([["agent-railly", store]]),
		});

		await expect(
			api.setAgentCronEnabled("agent-railly", "cron/daily.yaml", false),
		).resolves.toEqual({
			name: "Daily",
			path: "cron/daily.yaml",
			schedule: "15 6 * * *",
			scheduleKind: "recurring",
			timezone: "UTC",
			model: "haiku",
			enabled: false,
			status: "disabled",
		});

		await expect(api.listAgentCron("agent-railly")).resolves.toEqual([
			{
				name: "Daily",
				path: "cron/daily.yaml",
				schedule: "15 6 * * *",
				scheduleKind: "recurring",
				timezone: "UTC",
				model: "haiku",
				enabled: false,
				status: "disabled",
			},
		]);

		expect(readFileSync(cronPath, "utf8")).toContain("schedule: 15 6 * * *");

		store.close();
	});

	test("updates one-time cron enabled state without losing runAt", async () => {
		const root = createTempDir("outclaw-browser-cron-once-toggle-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		const cronDir = join(agentHomeDir, "cron");
		mkdirSync(cronDir, { recursive: true });
		const cronPath = join(cronDir, "once.yaml");
		writeFileSync(
			cronPath,
			'name: Once\nrunAt: "2999-01-23T09:00:00+00:00"\nenabled: true\nprompt: Check inbox once\n',
		);

		const store = new SessionStore(dbPath, { agentId: "agent-railly" });
		const api = createBrowserApi({
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					homeDir: agentHomeDir,
					providerId: "claude",
					terminalRunCommand: "",
				},
			],
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map([["agent-railly", store]]),
		});

		await expect(
			api.setAgentCronEnabled("agent-railly", "cron/once.yaml", false),
		).resolves.toEqual({
			name: "Once",
			path: "cron/once.yaml",
			schedule: "2999-01-23T09:00:00+00:00",
			scheduleKind: "once",
			runAt: "2999-01-23T09:00:00+00:00",
			enabled: false,
			status: "disabled",
		});
		expect(readFileSync(cronPath, "utf8")).toContain(
			"runAt: 2999-01-23T09:00:00+00:00",
		);
		expect(readFileSync(cronPath, "utf8")).not.toContain("schedule:");

		store.close();
	});

	test("marks expired one-time cron jobs in browser cron listings", async () => {
		const root = createTempDir("outclaw-browser-cron-expired-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		const cronDir = join(agentHomeDir, "cron");
		mkdirSync(cronDir, { recursive: true });
		writeFileSync(
			join(cronDir, "expired.yaml"),
			'name: Expired\nrunAt: "2000-01-23T09:00:00+00:00"\nenabled: true\nprompt: Check inbox once\n',
		);

		const store = new SessionStore(dbPath, { agentId: "agent-railly" });
		const api = createBrowserApi({
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					homeDir: agentHomeDir,
					providerId: "claude",
					terminalRunCommand: "",
				},
			],
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map([["agent-railly", store]]),
		});

		await expect(api.listAgentCron("agent-railly")).resolves.toEqual([
			{
				name: "Expired",
				path: "cron/expired.yaml",
				schedule: "2000-01-23T09:00:00+00:00",
				scheduleKind: "once",
				runAt: "2000-01-23T09:00:00+00:00",
				enabled: true,
				status: "expired",
			},
		]);

		store.close();
	});

	test("filters template cron yaml files from browser cron listings", async () => {
		const root = createTempDir("outclaw-browser-cron-filter-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		const cronDir = join(agentHomeDir, "cron");
		mkdirSync(cronDir, { recursive: true });
		writeFileSync(
			join(cronDir, "daily.yaml"),
			"name: Daily\nschedule: 15 6 * * *\nenabled: true\nprompt: Check inbox\n",
		);
		writeFileSync(
			join(cronDir, "_template.yaml"),
			"name: Template\nschedule: 0 0 * * *\nenabled: true\nprompt: Copy me\n",
		);

		const store = new SessionStore(dbPath, { agentId: "agent-railly" });
		const api = createBrowserApi({
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					homeDir: agentHomeDir,
					providerId: "claude",
					terminalRunCommand: "",
				},
			],
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map([["agent-railly", store]]),
		});

		await expect(api.listAgentCron("agent-railly")).resolves.toEqual([
			{
				name: "Daily",
				path: "cron/daily.yaml",
				schedule: "15 6 * * *",
				scheduleKind: "recurring",
				enabled: true,
				status: "scheduled",
			},
		]);

		store.close();
	});

	test("keeps invalid cron files visible with parse errors", async () => {
		const root = createTempDir("outclaw-browser-cron-invalid-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		const cronDir = join(agentHomeDir, "cron");
		mkdirSync(cronDir, { recursive: true });
		writeFileSync(join(cronDir, "broken.yaml"), "name: Broken\nprompt:\n");

		const store = new SessionStore(dbPath, { agentId: "agent-railly" });
		const api = createBrowserApi({
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					homeDir: agentHomeDir,
					providerId: "claude",
					terminalRunCommand: "",
				},
			],
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map([["agent-railly", store]]),
		});

		await expect(api.listAgentCron("agent-railly")).resolves.toEqual([
			{
				name: "broken.yaml",
				path: "cron/broken.yaml",
				schedule: "Invalid config",
				enabled: false,
				status: "invalid",
				error: expect.any(String),
			},
		]);

		store.close();
	});

	test("ignores managed skills symlink paths in git status", async () => {
		const root = createTempDir("outclaw-browser-git-symlink-");
		cleanupPaths.push(root);

		const agentHomeDir = join(root, "agents", "railly");
		const skillsDir = join(agentHomeDir, "skills");
		const claudeDir = join(agentHomeDir, ".claude");
		const ignoredGitPath = "agents/railly/.claude/skills";
		mkdirSync(skillsDir, { recursive: true });
		mkdirSync(claudeDir, { recursive: true });

		runGit(root, ["init", "--initial-branch=main"]);
		runGit(root, ["config", "user.email", "test@example.com"]);
		runGit(root, ["config", "user.name", "Test User"]);
		writeFileSync(join(root, "README.md"), "seed\n");
		runGit(root, ["add", "README.md"]);
		runGit(root, ["commit", "-m", "Initial commit"]);

		symlinkSync("../skills", join(claudeDir, "skills"));
		mkdirSync(join(skillsDir, "oc"), { recursive: true });
		writeFileSync(join(skillsDir, "oc", "SKILL.md"), "name: oc\n");

		const api = createBrowserApi({
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					homeDir: agentHomeDir,
					providerId: "claude",
					terminalRunCommand: "",
				},
			],
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			ignoredGitPaths: [ignoredGitPath],
			storesByAgent: new Map(),
		});

		const status = await api.readGitStatus();
		if (!status.initialized) {
			throw new Error("expected initialized git status");
		}
		expect(status.files).toEqual([
			expect.objectContaining({
				path: "agents/railly/skills/oc/SKILL.md",
			}),
		]);
		expect(status.files).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: ignoredGitPath,
				}),
			]),
		);
	});

	test("reports uninitialized status when the git root is not a repo", async () => {
		const root = createTempDir("outclaw-browser-git-uninit-");
		cleanupPaths.push(root);

		const agentHomeDir = join(root, "agents", "railly");
		mkdirSync(agentHomeDir, { recursive: true });

		const api = createBrowserApi({
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					homeDir: agentHomeDir,
					providerId: "claude",
					terminalRunCommand: "",
				},
			],
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map(),
		});

		const status = await api.readGitStatus();
		expect(status).toEqual({
			initialized: false,
			root,
		});
	});

	test("initGitRepo initializes the git root and readGitStatus reports it", async () => {
		const root = createTempDir("outclaw-browser-git-init-");
		cleanupPaths.push(root);

		const agentHomeDir = join(root, "agents", "railly");
		mkdirSync(agentHomeDir, { recursive: true });

		const api = createBrowserApi({
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					homeDir: agentHomeDir,
					providerId: "claude",
					terminalRunCommand: "",
				},
			],
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map(),
		});

		const before = await api.readGitStatus();
		expect(before.initialized).toBe(false);

		const after = await api.initGitRepo();
		expect(after.initialized).toBe(true);
		expect(existsSync(join(root, ".git"))).toBe(true);

		const status = await api.readGitStatus();
		expect(status.initialized).toBe(true);
	});

	test("reads git status in an unborn repo with the correct branch and line counts", async () => {
		const root = createTempDir("outclaw-browser-git-unborn-");
		cleanupPaths.push(root);

		const agentHomeDir = join(root, "agents", "railly");
		mkdirSync(agentHomeDir, { recursive: true });
		writeFileSync(join(root, "README.md"), "# Outclaw\n");

		const api = createBrowserApi({
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					homeDir: agentHomeDir,
					providerId: "claude",
					terminalRunCommand: "",
				},
			],
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map(),
		});

		runGit(root, ["init", "--initial-branch=main"]);
		runGit(root, ["add", "README.md"]);
		writeFileSync(join(root, "README.md"), "# Outclaw\n\nHello\n");

		const status = await api.readGitStatus();
		if (!status.initialized) {
			throw new Error("expected initialized git status");
		}

		expect(status.branch).toBe("main");
		expect(status.files).toEqual([
			expect.objectContaining({
				path: "README.md",
				indexStatus: "A",
				worktreeStatus: "M",
				additions: 3,
				deletions: 0,
			}),
		]);
	});

	test("treats only the exact git root as initialized", async () => {
		const parentRoot = createTempDir("outclaw-browser-git-parent-");
		cleanupPaths.push(parentRoot);

		const childRoot = join(parentRoot, ".outclaw");
		const agentHomeDir = join(childRoot, "agents", "railly");
		mkdirSync(agentHomeDir, { recursive: true });

		runGit(parentRoot, ["init", "--initial-branch=main"]);

		const api = createBrowserApi({
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					homeDir: agentHomeDir,
					providerId: "claude",
					terminalRunCommand: "",
				},
			],
			getRememberedAgentId: () => undefined,
			gitRoot: childRoot,
			homeDir: childRoot,
			storesByAgent: new Map(),
		});

		await expect(api.readGitStatus()).resolves.toEqual({
			initialized: false,
			root: childRoot,
		});
	});
});

function runGit(cwd: string, args: string[]) {
	const result = Bun.spawnSync(["git", ...args], {
		cwd,
		env: Object.fromEntries(
			Object.entries(process.env).filter(
				([key, value]) => !key.startsWith("GIT_") && value !== undefined,
			),
		),
		stderr: "pipe",
		stdout: "pipe",
	});
	if (result.exitCode !== 0) {
		throw new Error(result.stderr.toString().trim() || "git command failed");
	}
	return result.stdout.toString();
}

function restoreProcessEnvValue(key: string, value: string | undefined) {
	if (value === undefined) {
		delete process.env[key];
		return;
	}
	process.env[key] = value;
}
