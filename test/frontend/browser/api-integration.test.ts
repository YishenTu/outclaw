import { afterEach, describe, expect, test } from "bun:test";
import {
	fetchAgentCron,
	fetchAgentCronHistory,
	fetchAgentFile,
	fetchAgentTree,
	fetchAgentWorkspaceFiles,
	fetchConfigFile,
	fetchGitCommit,
	fetchGitDiff,
	fetchGitStatus,
	fetchRuntimeLatency,
	fetchSidebarSummary,
	initGitRepo,
	updateAgentCronEnabled,
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
				graph: { commits: [], branchHeads: [] },
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
				graph: { commits: [], branchHeads: [] },
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
			"file:agent-railly:notes/today.md",
			"diff:src/index.ts",
			"commit:abc123",
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
