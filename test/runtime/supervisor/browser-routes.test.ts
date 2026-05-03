import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentRuntime } from "../../../src/runtime/application/create-agent-runtime.ts";
import { createSupervisor } from "../../../src/runtime/supervisor/create-supervisor.ts";
import { MockFacade } from "../../helpers/mock-facade.ts";

const TEST_CONFIG_SCHEMA = {
	kind: "object" as const,
	properties: {
		port: {
			kind: "leaf" as const,
			editorKinds: ["number"] as const,
			typeLabel: "number",
		},
	},
};

function createConfigResponse(content: string) {
	return {
		path: "config.json",
		kind: "text" as const,
		content,
		schema: TEST_CONFIG_SCHEMA,
		truncated: false,
	};
}

describe("createSupervisor browser routes", () => {
	let cleanup: (() => Promise<void>) | undefined;
	let tempDir: string | undefined;

	afterEach(async () => {
		await cleanup?.();
		cleanup = undefined;
		if (tempDir) {
			rmSync(tempDir, { recursive: true, force: true });
			tempDir = undefined;
		}
	});

	test("serves browser agent summaries over HTTP", async () => {
		const supervisor = createSupervisor({
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					facade: new MockFacade(),
				}),
			],
			browserApi: {
				getAgentTerminalCwd: () => undefined,
				listAgentCron: async () => [],
				listAgentTree: async () => [],
				listAgents: () => ({
					activeAgentId: "agent-railly",
					agents: [
						{
							agentId: "agent-railly",
							name: "railly",
							sessions: [],
						},
					],
				}),
				readConfigFile: async () =>
					createConfigResponse('{\n\t"port": 4000\n}\n'),
				writeConfigFile: async () => {
					throw new Error("Not implemented");
				},
				readAgentFile: async () => ({
					path: "AGENTS.md",
					kind: "text",
					content: "# Agent\n",
					truncated: false,
				}),
				readGitDiff: async () => ({
					path: "config.json",
					diff: "diff --git a/config.json b/config.json",
				}),
				readGitCommit: async () => ({
					sha: "abc1234",
					author: {
						name: "Test User",
						email: "test@example.com",
						date: "2026-04-18T00:00:00.000Z",
					},
					message: "Second commit",
					parents: [{ sha: "def5678" }],
					diff: "diff --git a/README.md b/README.md",
				}),
				readGitStatus: async () => ({
					initialized: true,
					root: "/tmp/.outclaw",
					branch: "main",
					ahead: 0,
					behind: 0,
					clean: true,
					graph: { commits: [], branchHeads: [] },
					files: [],
				}),
				initGitRepo: async () => ({
					initialized: false,
					root: "/tmp/.outclaw",
				}),
				setAgentCronEnabled: async () => {
					throw new Error("Not implemented");
				},
			},
			port: 0,
		});
		cleanup = () => supervisor.stop();

		const response = await fetch(
			`http://localhost:${supervisor.port}/api/agents`,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			activeAgentId: "agent-railly",
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					sessions: [],
				},
			],
		});
	});

	test("serves browser file reads over HTTP", async () => {
		const supervisor = createSupervisor({
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					facade: new MockFacade(),
				}),
			],
			browserApi: {
				getAgentTerminalCwd: () => undefined,
				listAgentCron: async () => [],
				listAgentWorkspaceFiles: async () => [
					{ kind: "file", path: "AGENTS.md" },
				],
				listAgentTree: async () => [],
				listAgents: () => ({
					activeAgentId: "agent-railly",
					agents: [],
				}),
				readConfigFile: async () =>
					createConfigResponse('{\n\t"port": 4000\n}\n'),
				writeConfigFile: async () => {
					throw new Error("Not implemented");
				},
				readAgentFile: async (_agentId, path) => ({
					path,
					kind: "text",
					content: "# Agent\n",
					truncated: false,
				}),
				readGitDiff: async () => ({
					path: "config.json",
					diff: "",
				}),
				readGitCommit: async () => ({
					sha: "abc1234",
					author: {
						name: "Test User",
						email: "test@example.com",
						date: "2026-04-18T00:00:00.000Z",
					},
					message: "Second commit",
					parents: [{ sha: "def5678" }],
					diff: "diff --git a/README.md b/README.md",
				}),
				readGitStatus: async () => ({
					initialized: true,
					root: "/tmp/.outclaw",
					branch: "main",
					ahead: 0,
					behind: 0,
					clean: true,
					graph: { commits: [], branchHeads: [] },
					files: [],
				}),
				initGitRepo: async () => ({
					initialized: false,
					root: "/tmp/.outclaw",
				}),
				setAgentCronEnabled: async () => {
					throw new Error("Not implemented");
				},
			},
			port: 0,
		});
		cleanup = () => supervisor.stop();

		const response = await fetch(
			`http://localhost:${supervisor.port}/api/agents/agent-railly/files?path=AGENTS.md`,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			path: "AGENTS.md",
			kind: "text",
			content: "# Agent\n",
			truncated: false,
		});

		const workspaceFilesResponse = await fetch(
			`http://localhost:${supervisor.port}/api/agents/agent-railly/workspace-files`,
		);
		expect(workspaceFilesResponse.status).toBe(200);
		await expect(workspaceFilesResponse.json()).resolves.toEqual([
			{ kind: "file", path: "AGENTS.md" },
		]);
	});

	test("serves browser inbox list, note, archive, and restore actions over HTTP", async () => {
		const calls: string[] = [];
		const supervisor = createSupervisor({
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					facade: new MockFacade(),
				}),
			],
			browserApi: {
				getAgentTerminalCwd: () => undefined,
				listAgentCron: async () => [],
				listAgentInbox: async (agentId) => {
					calls.push(`list:${agentId}`);
					return {
						archivedItems: [],
						items: [
							{
								location: "inbox",
								modifiedAt: "2026-04-02T00:00:00.000Z",
								name: "todo.md",
								path: "inbox/todo.md",
								size: 4,
							},
						],
						pendingCount: 1,
					};
				},
				archiveAgentInboxItem: async (agentId, path) => {
					calls.push(`archive:${agentId}:${path}`);
					return {
						archivedPath: "inbox/archive/todo.md",
						item: {
							location: "archive",
							modifiedAt: "2026-04-02T00:00:00.000Z",
							name: "todo.md",
							path: "inbox/archive/todo.md",
							size: 4,
						},
						originalPath: path,
					};
				},
				createAgentInboxNote: async (agentId, input) => {
					calls.push(`note:${agentId}:${input.title}:${input.body}`);
					return {
						item: {
							location: "inbox",
							modifiedAt: "2026-04-02T00:00:00.000Z",
							name: "follow-up.md",
							path: "inbox/follow-up.md",
							size: 32,
						},
						path: "inbox/follow-up.md",
					};
				},
				restoreAgentInboxItem: async (agentId, archivedPath, originalPath) => {
					calls.push(`restore:${agentId}:${archivedPath}:${originalPath}`);
					return {
						archivedPath,
						item: {
							location: "inbox",
							modifiedAt: "2026-04-02T00:00:00.000Z",
							name: "todo.md",
							path: "inbox/todo.md",
							size: 4,
						},
						restoredPath: originalPath,
					};
				},
				listAgentTree: async () => [],
				listAgents: () => ({
					activeAgentId: "agent-railly",
					agents: [],
				}),
				readConfigFile: async () =>
					createConfigResponse('{\n\t"port": 4000\n}\n'),
				writeConfigFile: async () => {
					throw new Error("Not implemented");
				},
				readAgentFile: async (_agentId, path) => ({
					path,
					kind: "text",
					content: "# Agent\n",
					truncated: false,
				}),
				readGitDiff: async () => ({
					path: "config.json",
					diff: "",
				}),
				readGitCommit: async () => ({
					sha: "abc1234",
					author: {
						name: "Test User",
						email: "test@example.com",
						date: "2026-04-18T00:00:00.000Z",
					},
					message: "Second commit",
					parents: [{ sha: "def5678" }],
					diff: "diff --git a/README.md b/README.md",
				}),
				readGitStatus: async () => ({
					initialized: true,
					root: "/tmp/.outclaw",
					branch: "main",
					ahead: 0,
					behind: 0,
					clean: true,
					graph: { commits: [], branchHeads: [] },
					files: [],
				}),
				initGitRepo: async () => ({
					initialized: false,
					root: "/tmp/.outclaw",
				}),
				setAgentCronEnabled: async () => {
					throw new Error("Not implemented");
				},
			},
			port: 0,
		});
		cleanup = () => supervisor.stop();

		const listResponse = await fetch(
			`http://localhost:${supervisor.port}/api/agents/agent-railly/inbox`,
		);
		expect(listResponse.status).toBe(200);
		await expect(listResponse.json()).resolves.toMatchObject({
			pendingCount: 1,
			items: [{ path: "inbox/todo.md" }],
		});

		const archiveResponse = await fetch(
			`http://localhost:${supervisor.port}/api/agents/agent-railly/inbox/archive`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
				},
				body: JSON.stringify({
					path: "inbox/todo.md",
				}),
			},
		);
		expect(archiveResponse.status).toBe(200);
		await expect(archiveResponse.json()).resolves.toMatchObject({
			archivedPath: "inbox/archive/todo.md",
			originalPath: "inbox/todo.md",
		});

		const noteResponse = await fetch(
			`http://localhost:${supervisor.port}/api/agents/agent-railly/inbox/note`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
				},
				body: JSON.stringify({
					body: "Check report.",
					title: "Follow Up",
				}),
			},
		);
		expect(noteResponse.status).toBe(200);
		await expect(noteResponse.json()).resolves.toMatchObject({
			path: "inbox/follow-up.md",
		});

		const restoreResponse = await fetch(
			`http://localhost:${supervisor.port}/api/agents/agent-railly/inbox/restore`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
				},
				body: JSON.stringify({
					archivedPath: "inbox/archive/todo.md",
					originalPath: "inbox/todo.md",
				}),
			},
		);
		expect(restoreResponse.status).toBe(200);
		await expect(restoreResponse.json()).resolves.toMatchObject({
			archivedPath: "inbox/archive/todo.md",
			restoredPath: "inbox/todo.md",
		});
		expect(calls).toEqual([
			"list:agent-railly",
			"archive:agent-railly:inbox/todo.md",
			"note:agent-railly:Follow Up:Check report.",
			"restore:agent-railly:inbox/archive/todo.md:inbox/todo.md",
		]);
	});

	test("serves the runtime config file over HTTP", async () => {
		const supervisor = createSupervisor({
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					facade: new MockFacade(),
				}),
			],
			browserApi: {
				getAgentTerminalCwd: () => undefined,
				listAgentCron: async () => [],
				listAgentTree: async () => [],
				listAgents: () => ({
					activeAgentId: "agent-railly",
					agents: [],
				}),
				readConfigFile: async () =>
					createConfigResponse('{\n\t"port": 4000\n}\n'),
				writeConfigFile: async (document) =>
					createConfigResponse(`${JSON.stringify(document, null, "\t")}\n`),
				readAgentFile: async (_agentId, path) => ({
					path,
					kind: "text",
					content: "# Agent\n",
					truncated: false,
				}),
				readGitDiff: async () => ({
					path: "config.json",
					diff: "",
				}),
				readGitCommit: async () => ({
					sha: "abc1234",
					author: {
						name: "Test User",
						email: "test@example.com",
						date: "2026-04-18T00:00:00.000Z",
					},
					message: "Second commit",
					parents: [{ sha: "def5678" }],
					diff: "diff --git a/README.md b/README.md",
				}),
				readGitStatus: async () => ({
					initialized: true,
					root: "/tmp/.outclaw",
					branch: "main",
					ahead: 0,
					behind: 0,
					clean: true,
					graph: { commits: [], branchHeads: [] },
					files: [],
				}),
				initGitRepo: async () => ({
					initialized: false,
					root: "/tmp/.outclaw",
				}),
				setAgentCronEnabled: async () => {
					throw new Error("Not implemented");
				},
			},
			port: 0,
		});
		cleanup = () => supervisor.stop();

		const response = await fetch(
			`http://localhost:${supervisor.port}/api/config`,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual(
			createConfigResponse('{\n\t"port": 4000\n}\n'),
		);
	});

	test("updates the runtime config file over HTTP", async () => {
		const supervisor = createSupervisor({
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					facade: new MockFacade(),
				}),
			],
			browserApi: {
				getAgentTerminalCwd: () => undefined,
				listAgentCron: async () => [],
				listAgentTree: async () => [],
				listAgents: () => ({
					activeAgentId: "agent-railly",
					agents: [],
				}),
				readConfigFile: async () =>
					createConfigResponse('{\n\t"port": 4000\n}\n'),
				writeConfigFile: async (document) =>
					createConfigResponse(`${JSON.stringify(document, null, "\t")}\n`),
				readAgentFile: async (_agentId, path) => ({
					path,
					kind: "text",
					content: "# Agent\n",
					truncated: false,
				}),
				readGitDiff: async () => ({
					path: "config.json",
					diff: "",
				}),
				readGitCommit: async () => ({
					sha: "abc1234",
					author: {
						name: "Test User",
						email: "test@example.com",
						date: "2026-04-18T00:00:00.000Z",
					},
					message: "Second commit",
					parents: [{ sha: "def5678" }],
					diff: "diff --git a/README.md b/README.md",
				}),
				readGitStatus: async () => ({
					initialized: true,
					root: "/tmp/.outclaw",
					branch: "main",
					ahead: 0,
					behind: 0,
					clean: true,
					graph: { commits: [], branchHeads: [] },
					files: [],
				}),
				initGitRepo: async () => ({
					initialized: false,
					root: "/tmp/.outclaw",
				}),
				setAgentCronEnabled: async () => {
					throw new Error("Not implemented");
				},
			},
			port: 0,
		});
		cleanup = () => supervisor.stop();

		const response = await fetch(
			`http://localhost:${supervisor.port}/api/config`,
			{
				method: "PATCH",
				headers: {
					"content-type": "application/json",
				},
				body: JSON.stringify({
					document: {
						host: "127.0.0.1",
						port: 4100,
					},
				}),
			},
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual(
			createConfigResponse('{\n\t"host": "127.0.0.1",\n\t"port": 4100\n}\n'),
		);
	});

	test("updates the agent terminal run command over HTTP", async () => {
		let command = "bun test";
		const supervisor = createSupervisor({
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					facade: new MockFacade(),
				}),
			],
			browserApi: {
				getAgentTerminalCwd: () => undefined,
				listAgentCron: async () => [],
				listAgentTree: async () => [],
				listAgents: () => ({
					activeAgentId: "agent-railly",
					agents: [],
				}),
				readConfigFile: async () =>
					createConfigResponse('{\n\t"port": 4000\n}\n'),
				writeConfigFile: async () => {
					throw new Error("Not implemented");
				},
				readAgentFile: async (_agentId, path) => ({
					path,
					kind: "text",
					content: "# Agent\n",
					truncated: false,
				}),
				writeAgentTerminalRunCommand: async (_agentId, nextCommand) => {
					command = nextCommand;
					return { command };
				},
				readGitDiff: async () => ({
					path: "config.json",
					diff: "",
				}),
				readGitCommit: async () => ({
					sha: "abc1234",
					author: {
						name: "Test User",
						email: "test@example.com",
						date: "2026-04-18T00:00:00.000Z",
					},
					message: "Second commit",
					parents: [{ sha: "def5678" }],
					diff: "diff --git a/README.md b/README.md",
				}),
				readGitStatus: async () => ({
					initialized: true,
					root: "/tmp/.outclaw",
					branch: "main",
					ahead: 0,
					behind: 0,
					clean: true,
					graph: { commits: [], branchHeads: [] },
					files: [],
				}),
				initGitRepo: async () => ({
					initialized: false,
					root: "/tmp/.outclaw",
				}),
				setAgentCronEnabled: async () => {
					throw new Error("Not implemented");
				},
			},
			port: 0,
		});
		cleanup = () => supervisor.stop();

		const writeResponse = await fetch(
			`http://localhost:${supervisor.port}/api/agents/agent-railly/terminal-run-command`,
			{
				method: "PATCH",
				headers: {
					"content-type": "application/json",
				},
				body: JSON.stringify({
					command: "bun run check",
				}),
			},
		);

		expect(writeResponse.status).toBe(200);
		await expect(writeResponse.json()).resolves.toEqual({
			command: "bun run check",
		});
	});

	test("initializes the git repo over HTTP", async () => {
		let initCalls = 0;
		const supervisor = createSupervisor({
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					facade: new MockFacade(),
				}),
			],
			browserApi: {
				getAgentTerminalCwd: () => undefined,
				listAgentCron: async () => [],
				listAgentTree: async () => [],
				listAgents: () => ({
					activeAgentId: "agent-railly",
					agents: [],
				}),
				readConfigFile: async () =>
					createConfigResponse('{\n\t"port": 4000\n}\n'),
				writeConfigFile: async () => {
					throw new Error("Not implemented");
				},
				readAgentFile: async (_agentId, path) => ({
					path,
					kind: "text",
					content: "# Agent\n",
					truncated: false,
				}),
				readGitDiff: async () => ({
					path: "config.json",
					diff: "",
				}),
				readGitCommit: async () => ({
					sha: "abc1234",
					author: {
						name: "Test User",
						email: "test@example.com",
						date: "2026-04-18T00:00:00.000Z",
					},
					message: "Second commit",
					parents: [{ sha: "def5678" }],
					diff: "diff --git a/README.md b/README.md",
				}),
				readGitStatus: async () => ({
					initialized: false,
					root: "/tmp/.outclaw",
				}),
				initGitRepo: async () => {
					initCalls += 1;
					return {
						initialized: true,
						root: "/tmp/.outclaw",
						branch: "main",
						ahead: 0,
						behind: 0,
						clean: true,
						graph: { commits: [], branchHeads: [] },
						files: [],
					};
				},
				setAgentCronEnabled: async () => {
					throw new Error("Not implemented");
				},
			},
			port: 0,
		});
		cleanup = () => supervisor.stop();

		const response = await fetch(
			`http://localhost:${supervisor.port}/api/git/init`,
			{
				method: "POST",
			},
		);

		expect(response.status).toBe(200);
		expect(initCalls).toBe(1);
		await expect(response.json()).resolves.toEqual({
			initialized: true,
			root: "/tmp/.outclaw",
			branch: "main",
			ahead: 0,
			behind: 0,
			clean: true,
			graph: { commits: [], branchHeads: [] },
			files: [],
		});
	});

	test("serves browser cron summaries over HTTP", async () => {
		const supervisor = createSupervisor({
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					facade: new MockFacade(),
				}),
			],
			browserApi: {
				getAgentTerminalCwd: () => undefined,
				listAgentCron: async () => [
					{
						name: "Morning check",
						path: "cron/morning.yaml",
						schedule: "0 9 * * *",
						scheduleKind: "recurring",
						model: "haiku",
						enabled: true,
						status: "scheduled",
					},
				],
				listAgentTree: async () => [],
				listAgents: () => ({
					activeAgentId: "agent-railly",
					agents: [],
				}),
				readConfigFile: async () =>
					createConfigResponse('{\n\t"port": 4000\n}\n'),
				writeConfigFile: async () => {
					throw new Error("Not implemented");
				},
				readAgentFile: async (_agentId, path) => ({
					path,
					kind: "text",
					content: "# Agent\n",
					truncated: false,
				}),
				readGitDiff: async () => ({
					path: "config.json",
					diff: "",
				}),
				readGitCommit: async () => ({
					sha: "abc1234",
					author: {
						name: "Test User",
						email: "test@example.com",
						date: "2026-04-18T00:00:00.000Z",
					},
					message: "Second commit",
					parents: [{ sha: "def5678" }],
					diff: "diff --git a/README.md b/README.md",
				}),
				readGitStatus: async () => ({
					initialized: true,
					root: "/tmp/.outclaw",
					branch: "main",
					ahead: 0,
					behind: 0,
					clean: true,
					graph: { commits: [], branchHeads: [] },
					files: [],
				}),
				initGitRepo: async () => ({
					initialized: false,
					root: "/tmp/.outclaw",
				}),
				setAgentCronEnabled: async (_agentId, path, enabled) => ({
					name: "Morning check",
					path,
					schedule: "0 9 * * *",
					scheduleKind: "recurring",
					model: "haiku",
					enabled,
					status: enabled ? "scheduled" : "disabled",
				}),
			},
			port: 0,
		});
		cleanup = () => supervisor.stop();

		const response = await fetch(
			`http://localhost:${supervisor.port}/api/agents/agent-railly/cron`,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual([
			{
				name: "Morning check",
				path: "cron/morning.yaml",
				schedule: "0 9 * * *",
				scheduleKind: "recurring",
				model: "haiku",
				enabled: true,
				status: "scheduled",
			},
		]);
	});

	test("updates cron enabled state over HTTP", async () => {
		const supervisor = createSupervisor({
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					facade: new MockFacade(),
				}),
			],
			browserApi: {
				getAgentTerminalCwd: () => undefined,
				listAgentCron: async () => [],
				listAgentTree: async () => [],
				listAgents: () => ({
					activeAgentId: "agent-railly",
					agents: [],
				}),
				readConfigFile: async () =>
					createConfigResponse('{\n\t"port": 4000\n}\n'),
				writeConfigFile: async () => {
					throw new Error("Not implemented");
				},
				readAgentFile: async (_agentId, path) => ({
					path,
					kind: "text",
					content: "# Agent\n",
					truncated: false,
				}),
				readGitDiff: async () => ({
					path: "config.json",
					diff: "",
				}),
				readGitCommit: async () => ({
					sha: "abc1234",
					author: {
						name: "Test User",
						email: "test@example.com",
						date: "2026-04-18T00:00:00.000Z",
					},
					message: "Second commit",
					parents: [{ sha: "def5678" }],
					diff: "diff --git a/README.md b/README.md",
				}),
				readGitStatus: async () => ({
					initialized: true,
					root: "/tmp/.outclaw",
					branch: "main",
					ahead: 0,
					behind: 0,
					clean: true,
					graph: { commits: [], branchHeads: [] },
					files: [],
				}),
				initGitRepo: async () => ({
					initialized: false,
					root: "/tmp/.outclaw",
				}),
				setAgentCronEnabled: async (_agentId, path, enabled) => ({
					name: "Morning check",
					path,
					schedule: "0 9 * * *",
					scheduleKind: "recurring",
					model: "haiku",
					enabled,
					status: enabled ? "scheduled" : "disabled",
				}),
			},
			port: 0,
		});
		cleanup = () => supervisor.stop();

		const response = await fetch(
			`http://localhost:${supervisor.port}/api/agents/agent-railly/cron`,
			{
				method: "PATCH",
				headers: {
					"content-type": "application/json",
				},
				body: JSON.stringify({
					path: "cron/morning.yaml",
					enabled: false,
				}),
			},
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			name: "Morning check",
			path: "cron/morning.yaml",
			schedule: "0 9 * * *",
			scheduleKind: "recurring",
			model: "haiku",
			enabled: false,
			status: "disabled",
		});
	});

	test("accepts browser image uploads over HTTP", async () => {
		const supervisor = createSupervisor({
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					facade: new MockFacade(),
				}),
			],
			browserApi: {
				getAgentTerminalCwd: () => undefined,
				listAgentCron: async () => [],
				listAgentTree: async () => [],
				listAgents: () => ({
					activeAgentId: "agent-railly",
					agents: [],
				}),
				readConfigFile: async () =>
					createConfigResponse('{\n\t"port": 4000\n}\n'),
				writeConfigFile: async () => {
					throw new Error("Not implemented");
				},
				readAgentFile: async (_agentId, path) => ({
					path,
					kind: "text",
					content: "# Agent\n",
					truncated: false,
				}),
				readGitCommit: async (sha) => ({
					sha,
					author: {
						name: "Test User",
						email: "test@example.com",
						date: "2026-04-18T00:00:00.000Z",
					},
					message: "Second commit",
					parents: [{ sha: "def5678" }],
					diff: "diff --git a/README.md b/README.md",
				}),
				readGitDiff: async () => ({
					path: "config.json",
					diff: "",
				}),
				readGitStatus: async () => ({
					initialized: true,
					root: "/tmp/.outclaw",
					branch: "main",
					ahead: 0,
					behind: 0,
					clean: true,
					graph: { commits: [], branchHeads: [] },
					files: [],
				}),
				initGitRepo: async () => ({
					initialized: false,
					root: "/tmp/.outclaw",
				}),
				uploadImages: async (images) =>
					images.map((image, index) => ({
						path: `/tmp/upload-${index}.png`,
						mediaType: image.mediaType,
					})),
				setAgentCronEnabled: async () => {
					throw new Error("Not implemented");
				},
			},
			port: 0,
		});
		cleanup = () => supervisor.stop();

		const body = new FormData();
		body.append(
			"images",
			new File(["png-bytes"], "cat.png", { type: "image/png" }),
		);

		const response = await fetch(
			`http://localhost:${supervisor.port}/api/images`,
			{
				method: "POST",
				body,
			},
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			images: [{ path: "/tmp/upload-0.png", mediaType: "image/png" }],
		});
	});

	test("serves browser git commit details over HTTP", async () => {
		const supervisor = createSupervisor({
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					facade: new MockFacade(),
				}),
			],
			browserApi: {
				getAgentTerminalCwd: () => undefined,
				listAgentCron: async () => [],
				listAgentTree: async () => [],
				listAgents: () => ({
					activeAgentId: "agent-railly",
					agents: [],
				}),
				readConfigFile: async () =>
					createConfigResponse('{\n\t"port": 4000\n}\n'),
				writeConfigFile: async () => {
					throw new Error("Not implemented");
				},
				readAgentFile: async (_agentId, path) => ({
					path,
					kind: "text",
					content: "# Agent\n",
					truncated: false,
				}),
				readGitCommit: async (sha) => ({
					sha,
					author: {
						name: "Test User",
						email: "test@example.com",
						date: "2026-04-18T00:00:00.000Z",
					},
					message: "Second commit\n\nExpanded body",
					parents: [{ sha: "def5678" }],
					diff: "diff --git a/README.md b/README.md",
				}),
				readGitDiff: async () => ({
					path: "config.json",
					diff: "",
				}),
				readGitStatus: async () => ({
					initialized: true,
					root: "/tmp/.outclaw",
					branch: "main",
					ahead: 0,
					behind: 0,
					clean: true,
					graph: { commits: [], branchHeads: [] },
					files: [],
				}),
				initGitRepo: async () => ({
					initialized: false,
					root: "/tmp/.outclaw",
				}),
				setAgentCronEnabled: async () => {
					throw new Error("Not implemented");
				},
			},
			port: 0,
		});
		cleanup = () => supervisor.stop();

		const response = await fetch(
			`http://localhost:${supervisor.port}/api/git/commit?sha=abc1234`,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			sha: "abc1234",
			author: {
				name: "Test User",
				email: "test@example.com",
				date: "2026-04-18T00:00:00.000Z",
			},
			message: "Second commit\n\nExpanded body",
			parents: [{ sha: "def5678" }],
			diff: "diff --git a/README.md b/README.md",
		});
	});

	test("serves the built browser app from the runtime root", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "outclaw-browser-app-"));
		writeFileSync(
			join(tempDir, "index.html"),
			"<!doctype html><html><body>OUTCLAW_BROWSER</body></html>",
		);

		const supervisor = createSupervisor({
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					facade: new MockFacade(),
				}),
			],
			browserApp: {
				distDir: tempDir,
			},
			port: 0,
		});
		cleanup = () => supervisor.stop();

		const response = await fetch(`http://localhost:${supervisor.port}/`);

		expect(response.status).toBe(200);
		expect(await response.text()).toContain("OUTCLAW_BROWSER");
	});

	test("returns oc build guidance when the browser app is missing", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "outclaw-browser-app-"));

		const supervisor = createSupervisor({
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					facade: new MockFacade(),
				}),
			],
			browserApp: {
				distDir: tempDir,
			},
			port: 0,
		});
		cleanup = () => supervisor.stop();

		const response = await fetch(`http://localhost:${supervisor.port}/`);

		expect(response.status).toBe(503);
		expect(await response.text()).toContain("oc build && oc restart");
	});

	test("serves browser app assets and falls back to index.html for SPA routes", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "outclaw-browser-app-"));
		writeFileSync(
			join(tempDir, "index.html"),
			"<!doctype html><html><body>OUTCLAW_SPA</body></html>",
		);
		writeFileSync(join(tempDir, "app.js"), "console.log('browser-app');\n");

		const supervisor = createSupervisor({
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					facade: new MockFacade(),
				}),
			],
			browserApp: {
				distDir: tempDir,
			},
			port: 0,
		});
		cleanup = () => supervisor.stop();

		const assetResponse = await fetch(
			`http://localhost:${supervisor.port}/app.js`,
		);
		expect(assetResponse.status).toBe(200);
		expect(await assetResponse.text()).toContain("browser-app");

		const routeResponse = await fetch(
			`http://localhost:${supervisor.port}/agents/railly`,
		);
		expect(routeResponse.status).toBe(200);
		expect(await routeResponse.text()).toContain("OUTCLAW_SPA");

		const missingAssetResponse = await fetch(
			`http://localhost:${supervisor.port}/missing.js`,
		);
		expect(missingAssetResponse.status).toBe(404);
	});
});
