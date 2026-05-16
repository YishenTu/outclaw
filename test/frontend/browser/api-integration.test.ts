import { afterEach, describe, expect, test } from "bun:test";
import {
	archiveCodingRepository,
	archiveCodingSession,
	deleteCodingSession,
	fetchAgentCron,
	fetchAgentCronHistory,
	fetchAgentFile,
	fetchAgentTree,
	fetchAgentWorkspaceFiles,
	fetchCodingRepositories,
	fetchCodingRepository,
	fetchCodingRepositoryTree,
	fetchCodingRepositoryWorkspaceFiles,
	fetchCodingSession,
	fetchCodingSessions,
	fetchConfigFile,
	fetchGitCommit,
	fetchGitDiff,
	fetchGitHistory,
	fetchGitStatus,
	fetchRuntimeLatency,
	fetchSidebarSummary,
	initGitRepo,
	registerCodingRepository,
	restoreCodingRepository,
	restoreCodingSession,
	stopCodingSession,
	updateAgentCronEnabled,
	updateCodingRepositoryTerminalRunCommand,
	updateConfigFile,
	uploadPromptImages,
} from "../../../src/frontend/browser/lib/api.ts";
import { createAgentRuntime } from "../../../src/runtime/application/create-agent-runtime.ts";
import { createSupervisor } from "../../../src/runtime/supervisor/create-supervisor.ts";
import { MockFacade } from "../../helpers/mock-facade.ts";

type BrowserApi = NonNullable<
	Parameters<typeof createSupervisor>[0]["browserApi"]
>;

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

const globalScope = globalThis as unknown as { window?: unknown };
const originalFetch = globalThis.fetch;
const originalWindow = globalScope.window;

function createConfigResponse(content: string) {
	return {
		path: "config.json",
		kind: "text" as const,
		content,
		schema: TEST_CONFIG_SCHEMA,
		truncated: false,
	};
}

function installBrowserFetch(baseUrl: string) {
	globalScope.window = {
		location: {
			origin: baseUrl,
		},
	};
	globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
		if (typeof input === "string" && input.startsWith("/")) {
			return originalFetch(new URL(input, baseUrl), init);
		}
		return originalFetch(input, init);
	}) as typeof fetch;
}

describe("browser API client integration", () => {
	let cleanup: (() => Promise<void>) | undefined;

	afterEach(async () => {
		await cleanup?.();
		cleanup = undefined;
		globalThis.fetch = originalFetch;
		if (originalWindow === undefined) {
			delete globalScope.window;
		} else {
			globalScope.window = originalWindow;
		}
	});

	test("drives supervisor HTTP routes through browser client helpers", async () => {
		const calls: string[] = [];
		let configDocument: Record<string, unknown> = { port: 4000 };
		const browserApi: BrowserApi = {
			getAgentTerminalCwd: () => undefined,
			listAgents: () => ({
				activeAgentId: "agent-railly",
				agents: [
					{
						agentId: "agent-railly",
						name: "railly",
						terminalRunCommand: "bun test",
						activeSession: {
							providerId: "mock",
							sdkSessionId: "sdk-active",
						},
						sessions: [
							{
								providerId: "mock",
								sdkSessionId: "sdk-active",
								title: "Active session",
								model: "mock-model",
								lastActive: 100,
							},
						],
					},
				],
			}),
			listAgentCron: async (agentId) => {
				calls.push(`cron:list:${agentId}`);
				return [
					{
						enabled: true,
						name: "daily",
						path: "cron/daily.yaml",
						prompt: "Reflect",
						schedule: "* * * * *",
						scheduleKind: "recurring",
						status: "scheduled",
					},
				];
			},
			listAgentCronHistory: async (agentId, params) => {
				calls.push(
					`cron:history:${agentId}:${params.jobName}:${params.limit}:${params.before?.ranAt ?? "none"}:${params.before?.providerId ?? "none"}:${params.before?.sessionId ?? "none"}`,
				);
				return {
					entries: [
						{
							providerId: "mock",
							sessionId: "cron-session-1",
							ranAt: 100,
							resultText: "ok",
						},
					],
					hasMore: false,
				};
			},
			listCodingSessions: async (params) => {
				calls.push(
					`coding:list:${params.limit}:${params.cursor?.lastActive ?? "none"}:${params.cursor?.sdkSessionId ?? "none"}:${params.providerId ?? "none"}:${params.repositoryId ?? "none"}:${params.linkedChatSessionId ?? "none"}:${params.lifecycleStatus ?? "none"}`,
				);
				return {
					sessions: [
						{
							providerId: "codex",
							sdkSessionId: "code-session-1",
							title: "Fix browser UX",
							model: "gpt-5.5",
							lastActive: 200,
							cwd: "/workspace/outclaw",
							lifecycleStatus: "open",
							runStatus: "running",
							createdAt: 100,
							source: "code",
							tag: "code",
						},
					],
				};
			},
			getCodingSession: async (providerId, sdkSessionId) => {
				calls.push(`coding:get:${providerId}:${sdkSessionId}`);
				return {
					providerId,
					sdkSessionId,
					title: "Fix browser UX",
					model: "gpt-5.5",
					lastActive: 200,
					cwd: "/workspace/outclaw",
					lifecycleStatus: "open",
					runStatus: "running",
					createdAt: 100,
					source: "code",
					tag: "code",
				};
			},
			deleteCodingSession: async (providerId, sdkSessionId) => {
				calls.push(`coding:delete:${providerId}:${sdkSessionId}`);
				return {
					deleted: true,
					providerId,
					sdkSessionId,
				};
			},
			archiveCodingSession: async (providerId, sdkSessionId) => {
				calls.push(`coding:archive:${providerId}:${sdkSessionId}`);
				return {
					archived: true,
					session: {
						providerId,
						sdkSessionId,
						title: "Fix browser UX",
						model: "gpt-5.5",
						lastActive: 300,
						cwd: "/workspace/outclaw",
						lifecycleStatus: "archived",
						runStatus: "idle",
						createdAt: 100,
						source: "code",
						tag: "code",
					},
				};
			},
			restoreCodingSession: async (providerId, sdkSessionId) => {
				calls.push(`coding:restore:${providerId}:${sdkSessionId}`);
				return {
					restored: true,
					session: {
						providerId,
						sdkSessionId,
						title: "Fix browser UX",
						model: "gpt-5.5",
						lastActive: 400,
						cwd: "/workspace/outclaw",
						lifecycleStatus: "open",
						runStatus: "idle",
						createdAt: 100,
						source: "code",
						tag: "code",
					},
				};
			},
			stopCodingSession: async (params) => {
				calls.push(`coding:stop:${params.providerId}:${params.sdkSessionId}`);
				return {
					status: "accepted",
					providerId: params.providerId,
					sdkSessionId: params.sdkSessionId,
				};
			},
			listCodingRepositories: async (params) => {
				calls.push(`repo:list:${params?.includeArchived ?? false}`);
				return {
					repositories: [
						{
							id: "repo-1",
							rootCwd: "/workspace/outclaw",
							displayName: "outclaw",
							source: "manual",
							status: "active",
							createdAt: 100,
							lastActive: 200,
						},
					],
				};
			},
			getCodingRepository: async (repositoryId) => {
				calls.push(`repo:get:${repositoryId}`);
				return {
					id: repositoryId,
					rootCwd: "/workspace/outclaw",
					displayName: "outclaw",
					source: "manual",
					status: "active",
					createdAt: 100,
					lastActive: 200,
				};
			},
			registerCodingRepository: async (params) => {
				calls.push(
					`repo:register:${params.rootCwd}:${params.displayName ?? "none"}`,
				);
				return {
					id: "repo-2",
					rootCwd: params.rootCwd,
					displayName: params.displayName ?? "repo",
					source: "manual",
					status: "active",
					createdAt: 300,
					lastActive: 300,
				};
			},
			archiveCodingRepository: async (repositoryId) => {
				calls.push(`repo:archive:${repositoryId}`);
				return {
					archived: true,
					repository: {
						id: repositoryId,
						rootCwd: "/workspace/outclaw",
						displayName: "outclaw",
						source: "manual",
						status: "archived",
						createdAt: 100,
						lastActive: 400,
					},
				};
			},
			restoreCodingRepository: async (repositoryId) => {
				calls.push(`repo:restore:${repositoryId}`);
				return {
					restored: true,
					repository: {
						id: repositoryId,
						rootCwd: "/workspace/outclaw",
						displayName: "outclaw",
						source: "manual",
						status: "active",
						createdAt: 100,
						lastActive: 500,
					},
				};
			},
			writeCodingRepositoryTerminalRunCommand: async (
				repositoryId,
				command,
			) => {
				calls.push(`repo:run-command:${repositoryId}:${command}`);
				return { command };
			},
			listCodingRepositoryWorkspaceFiles: async (repositoryId) => {
				calls.push(`repo:workspace-files:${repositoryId}`);
				return [
					{ kind: "directory", path: "node_modules" },
					{ kind: "file", path: "node_modules/dependency.js" },
					{ kind: "file", path: "README.md" },
				];
			},
			listCodingRepositoryTree: async (repositoryId, params) => {
				calls.push(`repo:tree:${repositoryId}:${params?.path ?? "root"}`);
				return [
					{
						kind: "directory",
						name: params?.path ? "feature" : "src",
						path: params?.path ? `${params.path}/feature` : "src",
					},
				];
			},
			listAgentTree: async (agentId) => {
				calls.push(`tree:${agentId}`);
				return [
					{
						kind: "file",
						name: "AGENTS.md",
						path: "AGENTS.md",
					},
				];
			},
			listAgentWorkspaceFiles: async (agentId) => {
				calls.push(`workspace-files:${agentId}`);
				return [{ kind: "file", path: "AGENTS.md" }];
			},
			readConfigFile: async () =>
				createConfigResponse(`${JSON.stringify(configDocument, null, "\t")}\n`),
			writeConfigFile: async (document) => {
				configDocument = document;
				return createConfigResponse(
					`${JSON.stringify(document, null, "\t")}\n`,
				);
			},
			readAgentFile: async (agentId, relativePath) => {
				calls.push(`file:${agentId}:${relativePath}`);
				return {
					path: relativePath,
					kind: "text",
					content: "# Agent\n",
					truncated: false,
				};
			},
			readGitStatus: async () => ({
				initialized: true,
				root: "/tmp/outclaw",
				branch: "main",
				ahead: 1,
				behind: 0,
				clean: false,
				history: { commits: [] },
				files: [
					{
						path: "src/index.ts",
						indexStatus: " ",
						worktreeStatus: "M",
						additions: 2,
						deletions: 1,
					},
				],
			}),
			initGitRepo: async () => ({
				initialized: true,
				root: "/tmp/outclaw",
				branch: "main",
				ahead: 0,
				behind: 0,
				clean: true,
				history: { commits: [] },
				files: [],
			}),
			readGitDiff: async (path) => {
				calls.push(`diff:${path}`);
				return {
					path,
					diff: `diff --git a/${path} b/${path}`,
				};
			},
			readGitCommit: async (sha) => {
				calls.push(`commit:${sha}`);
				return {
					sha,
					author: {
						name: "Test User",
						email: "test@example.com",
						date: "2026-04-27T00:00:00.000Z",
					},
					message: "test commit",
					parents: [],
					diff: "diff --git a/README.md b/README.md",
				};
			},
			readGitCommitStats: async (sha) => ({
				sha,
				files: [],
				totalAdditions: 0,
				totalDeletions: 0,
			}),
			readGitHistory: async (params) => {
				calls.push(
					`history:${params?.repositoryId ?? "default"}:${params?.cursor ?? "none"}:${params?.limit ?? "none"}`,
				);
				return {
					commits: [
						{
							sha: "def456",
							commit: {
								author: {
									name: "Test User",
									date: "2026-05-12T00:00:00.000Z",
								},
								message: "Older commit",
							},
							parents: [],
						},
					],
					nextCursor: "45",
				};
			},
			uploadImages: async (images) => {
				calls.push(
					`upload:${images[0]?.mediaType}:${Array.from(images[0]?.bytes ?? []).join(",")}`,
				);
				return [{ path: "/tmp/outclaw/cat.png", mediaType: "image/png" }];
			},
			setAgentCronEnabled: async (agentId, relativePath, enabled) => {
				calls.push(`cron:set:${agentId}:${relativePath}:${enabled}`);
				return {
					enabled,
					name: "daily",
					path: relativePath,
					prompt: "Reflect",
					schedule: "* * * * *",
					scheduleKind: "recurring",
					status: enabled ? "scheduled" : "disabled",
				};
			},
		};
		const supervisor = createSupervisor({
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					facade: new MockFacade(),
				}),
			],
			browserApi,
			port: 0,
		});
		cleanup = () => supervisor.stop();
		const baseUrl = `http://localhost:${supervisor.port}`;
		installBrowserFetch(baseUrl);

		await expect(fetchSidebarSummary()).resolves.toEqual({
			activeAgentId: "agent-railly",
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					terminalRunCommand: "bun test",
					activeSession: {
						providerId: "mock",
						sdkSessionId: "sdk-active",
					},
					sessions: [
						{
							providerId: "mock",
							sdkSessionId: "sdk-active",
							title: "Active session",
							model: "mock-model",
							lastActive: 100,
						},
					],
				},
			],
		});
		await expect(fetchRuntimeLatency()).resolves.toMatchObject({
			ok: true,
			serverTimeMs: expect.any(Number),
		});
		await expect(fetchConfigFile()).resolves.toMatchObject({
			content: '{\n\t"port": 4000\n}\n',
		});
		await expect(updateConfigFile({ port: 5000 })).resolves.toMatchObject({
			content: '{\n\t"port": 5000\n}\n',
		});
		await expect(fetchAgentTree("agent-railly")).resolves.toEqual([
			{ kind: "file", name: "AGENTS.md", path: "AGENTS.md" },
		]);
		await expect(fetchAgentWorkspaceFiles("agent-railly")).resolves.toEqual([
			{ kind: "file", path: "AGENTS.md" },
		]);
		await expect(fetchAgentCron("agent-railly")).resolves.toMatchObject([
			{ enabled: true, name: "daily", path: "cron/daily.yaml" },
		]);
		await expect(
			fetchAgentCronHistory("agent-railly", {
				jobName: "daily",
				limit: 3,
				before: {
					ranAt: 200,
					providerId: "mock",
					sessionId: "cron-session-2",
				},
			}),
		).resolves.toEqual({
			entries: [
				{
					providerId: "mock",
					sessionId: "cron-session-1",
					ranAt: 100,
					resultText: "ok",
				},
			],
			hasMore: false,
		});
		await expect(
			updateAgentCronEnabled("agent-railly", "cron/daily.yaml", false),
		).resolves.toMatchObject({
			enabled: false,
			path: "cron/daily.yaml",
		});
		await expect(
			fetchCodingSessions({
				limit: 3,
				cursor: { lastActive: 200, sdkSessionId: "code-session-1" },
				providerId: "codex",
				repositoryId: "repo-1",
				linkedChatSessionId: "sdk-active",
				lifecycleStatus: "archived",
			}),
		).resolves.toMatchObject({
			sessions: [
				{
					providerId: "codex",
					sdkSessionId: "code-session-1",
					cwd: "/workspace/outclaw",
					lifecycleStatus: "open",
					runStatus: "running",
				},
			],
		});
		await expect(
			fetchCodingSession("codex", "code-session-1"),
		).resolves.toMatchObject({
			providerId: "codex",
			sdkSessionId: "code-session-1",
			cwd: "/workspace/outclaw",
		});
		await expect(
			deleteCodingSession("codex", "code-session-1"),
		).resolves.toEqual({
			deleted: true,
			providerId: "codex",
			sdkSessionId: "code-session-1",
		});
		await expect(
			archiveCodingSession("codex", "code-session-1"),
		).resolves.toMatchObject({
			archived: true,
			session: {
				providerId: "codex",
				sdkSessionId: "code-session-1",
				lifecycleStatus: "archived",
			},
		});
		await expect(
			restoreCodingSession("codex", "code-session-1"),
		).resolves.toMatchObject({
			restored: true,
			session: {
				providerId: "codex",
				sdkSessionId: "code-session-1",
				lifecycleStatus: "open",
			},
		});
		await expect(
			stopCodingSession({
				providerId: "codex",
				sdkSessionId: "code-session-1",
			}),
		).resolves.toEqual({
			status: "accepted",
			providerId: "codex",
			sdkSessionId: "code-session-1",
		});
		await expect(
			fetchCodingRepositories({ includeArchived: true }),
		).resolves.toMatchObject({
			repositories: [{ id: "repo-1" }],
		});
		await expect(fetchCodingRepository("repo-1")).resolves.toMatchObject({
			id: "repo-1",
		});
		await expect(
			fetchCodingRepositoryWorkspaceFiles("repo-1"),
		).resolves.toEqual([
			{ kind: "directory", path: "node_modules" },
			{ kind: "file", path: "node_modules/dependency.js" },
			{ kind: "file", path: "README.md" },
		]);
		await expect(fetchCodingRepositoryTree("repo-1")).resolves.toEqual([
			{
				kind: "directory",
				name: "src",
				path: "src",
			},
		]);
		await expect(fetchCodingRepositoryTree("repo-1", "src")).resolves.toEqual([
			{
				kind: "directory",
				name: "feature",
				path: "src/feature",
			},
		]);
		await expect(
			registerCodingRepository({
				rootCwd: "/workspace/outclaw",
				displayName: "Outclaw",
			}),
		).resolves.toMatchObject({
			id: "repo-2",
		});
		await expect(archiveCodingRepository("repo-1")).resolves.toMatchObject({
			archived: true,
			repository: {
				id: "repo-1",
				status: "archived",
			},
		});
		await expect(restoreCodingRepository("repo-1")).resolves.toMatchObject({
			restored: true,
			repository: {
				id: "repo-1",
				status: "active",
			},
		});
		await expect(
			updateCodingRepositoryTerminalRunCommand("repo-1", "bun run check"),
		).resolves.toEqual({
			command: "bun run check",
		});
		await expect(
			fetchAgentFile("agent-railly", "notes/today.md"),
		).resolves.toMatchObject({
			content: "# Agent\n",
			path: "notes/today.md",
		});
		await expect(fetchGitStatus()).resolves.toMatchObject({
			branch: "main",
			clean: false,
		});
		await expect(initGitRepo()).resolves.toMatchObject({
			initialized: true,
			clean: true,
		});
		await expect(fetchGitDiff("src/index.ts")).resolves.toEqual({
			path: "src/index.ts",
			diff: "diff --git a/src/index.ts b/src/index.ts",
		});
		await expect(fetchGitCommit("abc123")).resolves.toMatchObject({
			sha: "abc123",
			message: "test commit",
		});
		await expect(
			fetchGitHistory({
				repositoryId: "repo-1",
				cursor: "30",
				limit: 15,
			}),
		).resolves.toMatchObject({
			commits: [{ sha: "def456" }],
			nextCursor: "45",
		});
		await expect(
			uploadPromptImages([new File(["abc"], "cat.png", { type: "image/png" })]),
		).resolves.toEqual([
			{ path: "/tmp/outclaw/cat.png", mediaType: "image/png" },
		]);

		expect(calls).toEqual([
			"tree:agent-railly",
			"workspace-files:agent-railly",
			"cron:list:agent-railly",
			"cron:history:agent-railly:daily:3:200:mock:cron-session-2",
			"cron:set:agent-railly:cron/daily.yaml:false",
			"coding:list:3:200:code-session-1:codex:repo-1:sdk-active:archived",
			"coding:get:codex:code-session-1",
			"coding:delete:codex:code-session-1",
			"coding:archive:codex:code-session-1",
			"coding:restore:codex:code-session-1",
			"coding:stop:codex:code-session-1",
			"repo:list:true",
			"repo:get:repo-1",
			"repo:workspace-files:repo-1",
			"repo:tree:repo-1:root",
			"repo:tree:repo-1:src",
			"repo:register:/workspace/outclaw:Outclaw",
			"repo:archive:repo-1",
			"repo:restore:repo-1",
			"repo:run-command:repo-1:bun run check",
			"file:agent-railly:notes/today.md",
			"diff:src/index.ts",
			"commit:abc123",
			"history:repo-1:30:15",
			"upload:image/png:97,98,99",
		]);
	});

	test("surfaces JSON error bodies from supervisor routes", async () => {
		const browserApi: BrowserApi = {
			getAgentTerminalCwd: () => undefined,
			listAgents: () => ({ activeAgentId: undefined, agents: [] }),
			listAgentCron: async () => [],
			listAgentTree: async () => [],
			readConfigFile: async () => createConfigResponse("{}\n"),
			writeConfigFile: async () => createConfigResponse("{}\n"),
			readAgentFile: async () => {
				throw new Error("Path escapes agent directory");
			},
			readGitStatus: async () => ({ initialized: false, root: "/tmp/outclaw" }),
			initGitRepo: async () => ({ initialized: false, root: "/tmp/outclaw" }),
			readGitDiff: async () => {
				throw new Error("Path is required");
			},
			readGitCommit: async (sha) => {
				throw new Error(`Unknown commit: ${sha}`);
			},
			readGitCommitStats: async (sha) => {
				throw new Error(`Unknown commit: ${sha}`);
			},
			setAgentCronEnabled: async () => {
				throw new Error("Path escapes cron directory");
			},
		};
		const supervisor = createSupervisor({
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					facade: new MockFacade(),
				}),
			],
			browserApi,
			port: 0,
		});
		cleanup = () => supervisor.stop();
		installBrowserFetch(`http://localhost:${supervisor.port}`);

		await expect(fetchGitCommit("missing")).rejects.toThrow(
			"Unknown commit: missing",
		);
		await expect(fetchAgentFile("agent-railly", "../secret")).rejects.toThrow(
			"Path escapes agent directory",
		);
	});
});
