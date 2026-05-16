import { afterEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CodingSessionEvent } from "../../../src/common/protocol.ts";
import { createBrowserApi } from "../../../src/runtime/browser/create-browser-api.ts";
import {
	ChatCodingLinkStore,
	CODING_STORAGE_OWNER_ID,
	CodingRepositoryStore,
	CodingSessionEventHub,
	CodingSessionStore,
} from "../../../src/runtime/coding/index.ts";
import { SessionStore } from "../../../src/runtime/persistence/session-store/session-store.ts";

function createTempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

function unusedStopPrompt() {
	return {
		status: "rejected" as const,
		message: "unused",
	};
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

	test("builds sidebar summaries and active session across chat providers", async () => {
		const root = createTempDir("outclaw-browser-api-providers-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		mkdirSync(agentHomeDir, { recursive: true });

		const store = new SessionStore(dbPath, { agentId: "agent-railly" });
		store.upsert({
			providerId: "claude",
			sdkSessionId: "same-sdk-id",
			title: "Claude session",
			model: "opus",
		});
		store.upsert({
			providerId: "codex",
			sdkSessionId: "same-sdk-id",
			title: "Codex session",
			model: "gpt-5.5",
		});
		store.setActiveSessionId("claude", "same-sdk-id");
		store.setActiveSessionId("codex", "same-sdk-id");
		store.setBlankChatModelSelection({
			providerId: "codex",
			model: "gpt-5.5",
			effort: "medium",
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
			getRememberedAgentId: () => "agent-railly",
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map([["agent-railly", store]]),
		});

		expect(api.getAgentActiveSession("agent-railly")).toEqual({
			activeSession: {
				providerId: "codex",
				sdkSessionId: "same-sdk-id",
			},
			blankSelection: {
				providerId: "codex",
				model: "gpt-5.5",
				effort: "medium",
			},
		});
		expect(api.listAgents().agents[0]?.activeSession).toEqual({
			providerId: "codex",
			sdkSessionId: "same-sdk-id",
		});
		expect(api.listAgents().agents[0]?.sessions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					providerId: "claude",
					sdkSessionId: "same-sdk-id",
					title: "Claude session",
				}),
				expect.objectContaining({
					providerId: "codex",
					sdkSessionId: "same-sdk-id",
					title: "Codex session",
				}),
			]),
		);
		await expect(
			api.listAgentSessions("agent-railly", { limit: 10 }),
		).resolves.toMatchObject({
			sessions: expect.arrayContaining([
				expect.objectContaining({ providerId: "claude" }),
				expect.objectContaining({ providerId: "codex" }),
			]),
		});

		store.close();
	});

	test("lists chat models across configured providers", async () => {
		const root = createTempDir("outclaw-browser-api-chat-models-");
		cleanupPaths.push(root);

		const api = createBrowserApi({
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					homeDir: join(root, "agents", "railly"),
					providerId: "claude",
					terminalRunCommand: "",
				},
			],
			chatProvidersByAgent: new Map([
				[
					"agent-railly",
					[
						{
							providerId: "claude",
							displayName: "Claude",
							async listModels() {
								return [
									{
										id: "sonnet",
										model: "sonnet",
										displayName: "Sonnet",
										description: "Claude Sonnet",
										isDefault: true,
										defaultReasoningEffort: "medium",
										supportedReasoningEfforts: ["low", "medium", "high"],
										serviceTiers: [],
									},
								];
							},
						},
						{
							providerId: "codex",
							displayName: "Codex",
							async listModels() {
								return [
									{
										id: "gpt-5.5",
										model: "gpt-5.5",
										displayName: "GPT-5.5",
										description: "Codex model",
										isDefault: true,
										defaultReasoningEffort: "medium",
										supportedReasoningEfforts: [
											"low",
											"medium",
											"high",
											"xhigh",
										],
										serviceTiers: [
											{
												id: "priority",
												name: "Priority",
												description: "Fast",
											},
										],
									},
								];
							},
						},
					],
				],
			]),
			getRememberedAgentId: () => "agent-railly",
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map(),
		});

		await expect(api.listAgentChatModels("agent-railly")).resolves.toEqual({
			models: [
				expect.objectContaining({
					providerId: "claude",
					providerDisplayName: "Claude",
					model: "sonnet",
				}),
				expect.objectContaining({
					providerId: "codex",
					providerDisplayName: "Codex",
					model: "gpt-5.5",
					serviceTiers: [
						{
							id: "priority",
							name: "Priority",
							description: "Fast",
						},
					],
				}),
			],
		});
	});

	test("uses browser cookie binding for the sidebar active agent", () => {
		const root = createTempDir("outclaw-browser-api-");
		cleanupPaths.push(root);

		const cookieAgents = new Map([["browser-1", "agent-mimi"]]);
		const api = createBrowserApi({
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					homeDir: join(root, "agents", "railly"),
					providerId: "claude",
					terminalRunCommand: "",
				},
				{
					agentId: "agent-mimi",
					name: "mimi",
					homeDir: join(root, "agents", "mimi"),
					providerId: "claude",
					terminalRunCommand: "",
				},
			],
			getBrowserClientAgentId: (clientId: string) => cookieAgents.get(clientId),
			getRememberedAgentId: () => "agent-railly",
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map(),
		});

		expect(api.listAgents({ browserClientId: "browser-1" }).activeAgentId).toBe(
			"agent-mimi",
		);
		expect(api.listAgents().activeAgentId).toBe("agent-railly");
	});

	test("lists and searches paginated agent sessions", async () => {
		const root = createTempDir("outclaw-browser-sessions-api-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		mkdirSync(agentHomeDir, { recursive: true });

		const store = new SessionStore(dbPath, { agentId: "agent-railly" });
		for (const params of [
			{
				sdkSessionId: "sdk-a",
				title: "Refactor auth middleware",
				timestamp: 300,
			},
			{ sdkSessionId: "sdk-b", title: "Auth handlers", timestamp: 200 },
			{ sdkSessionId: "sdk-c", title: "Billing work", timestamp: 100 },
		]) {
			store.upsert({
				providerId: "claude",
				sdkSessionId: params.sdkSessionId,
				title: params.title,
				model: "opus",
				timestamp: params.timestamp,
			});
		}

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

		const firstPage = await api.listAgentSessions("agent-railly", { limit: 2 });
		expect(firstPage.sessions.map((session) => session.sdkSessionId)).toEqual([
			"sdk-a",
			"sdk-b",
		]);
		expect(firstPage.nextCursor).toEqual({
			lastActive: 200,
			sdkSessionId: "sdk-b",
		});
		expect(
			(
				await api.listAgentSessions("agent-railly", {
					cursor: firstPage.nextCursor,
					limit: 2,
				})
			).sessions.map((session) => session.sdkSessionId),
		).toEqual(["sdk-c"]);
		expect(
			(
				await api.listAgentSessions("agent-railly", {
					limit: 10,
					query: "auth middle",
				})
			).sessions.map((session) => session.sdkSessionId),
		).toEqual(["sdk-a"]);

		store.close();
	});

	test("returns the active chat session for an agent", () => {
		const root = createTempDir("outclaw-browser-active-session-api-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		mkdirSync(agentHomeDir, { recursive: true });

		const store = new SessionStore(dbPath, { agentId: "agent-railly" });
		store.upsert({
			providerId: "claude",
			sdkSessionId: "chat-session",
			title: "Current chat",
			model: "opus",
			tag: "chat",
			timestamp: 100,
		});
		store.setActiveSessionId("claude", "chat-session");

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

		expect(api.getAgentActiveSession("agent-railly")).toEqual({
			activeSession: {
				providerId: "claude",
				sdkSessionId: "chat-session",
			},
		});

		store.setActiveSessionId("claude", "missing-session");
		expect(api.getAgentActiveSession("agent-railly")).toEqual({});

		store.close();
	});

	test("lists coding sessions from the daemon coding store", async () => {
		const root = createTempDir("outclaw-browser-coding-sessions-api-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		mkdirSync(agentHomeDir, { recursive: true });

		const store = new SessionStore(dbPath, {
			agentId: CODING_STORAGE_OWNER_ID,
		});
		const codingStore = new CodingSessionStore(dbPath);
		const repositories = new CodingRepositoryStore(dbPath);
		const repository = repositories.register({
			rootCwd: join(root, "workspace"),
			source: "manual",
			timestamp: 100,
		});
		store.upsert({
			providerId: "claude",
			sdkSessionId: "chat-session",
			title: "Ordinary chat",
			model: "opus",
			tag: "chat",
			timestamp: 300,
		});
		store.upsert({
			providerId: "codex",
			sdkSessionId: "code-session",
			title: "Fix browser coding UX",
			model: "gpt-5.5",
			source: "code",
			tag: "code",
			timestamp: 200,
		});
		codingStore.upsert({
			providerId: "codex",
			sdkSessionId: "code-session",
			repositoryId: repository.id,
			cwd: join(root, "workspace"),
			linkedChatSessionId: "chat-session",
			runStatus: "running",
			timestamp: 250,
		});
		store.upsert({
			providerId: "codex",
			sdkSessionId: "other-code-session",
			title: "Other coding UX",
			model: "gpt-5.5",
			source: "code",
			tag: "code",
			timestamp: 300,
		});
		codingStore.upsert({
			providerId: "codex",
			sdkSessionId: "other-code-session",
			cwd: join(root, "other-workspace"),
			runStatus: "running",
			timestamp: 300,
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
			codingSessions: codingStore,
			getRememberedAgentId: () => "agent-railly",
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map([["agent-railly", store]]),
		});

		await expect(
			api.listCodingSessions({
				limit: 10,
				repositoryId: repository.id,
			}),
		).resolves.toEqual({
			sessions: [
				{
					providerId: "codex",
					sdkSessionId: "code-session",
					repositoryId: repository.id,
					title: "Fix browser coding UX",
					model: "gpt-5.5",
					lastActive: 250,
					cwd: join(root, "workspace"),
					lifecycleStatus: "open",
					runStatus: "running",
					createdAt: 250,
					source: "code",
					tag: "code",
					linkedChatSessionId: "chat-session",
				},
			],
		});

		repositories.close();
		codingStore.close();
		store.close();
	});

	test("links and lists coding sessions for a chat session", async () => {
		const root = createTempDir("outclaw-browser-chat-coding-links-api-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		mkdirSync(agentHomeDir, { recursive: true });

		const chatStore = new SessionStore(dbPath, { agentId: "agent-railly" });
		const codingSharedStore = new SessionStore(dbPath, {
			agentId: CODING_STORAGE_OWNER_ID,
		});
		const codingStore = new CodingSessionStore(dbPath);
		const links = new ChatCodingLinkStore(dbPath);

		chatStore.upsert({
			providerId: "claude",
			sdkSessionId: "chat-session",
			title: "Build the tool",
			model: "opus",
			tag: "chat",
			timestamp: 100,
		});
		for (const params of [
			{ sdkSessionId: "code-1", title: "First coding task", timestamp: 200 },
			{ sdkSessionId: "code-2", title: "Second coding task", timestamp: 300 },
		]) {
			codingSharedStore.upsert({
				providerId: "codex",
				sdkSessionId: params.sdkSessionId,
				title: params.title,
				model: "gpt-5.5",
				source: "code",
				tag: "code",
				timestamp: params.timestamp,
			});
			codingStore.upsert({
				providerId: "codex",
				sdkSessionId: params.sdkSessionId,
				cwd: join(root, "workspace"),
				runStatus: "idle",
				timestamp: params.timestamp,
			});
		}

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
			chatCodingLinks: links,
			codingSessions: codingStore,
			getRememberedAgentId: () => "agent-railly",
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map([["agent-railly", chatStore]]),
		});

		api.linkChatCodingSession({
			chatAgentId: "agent-railly",
			chatProviderId: "claude",
			chatSdkSessionId: "chat-session",
			codingProviderId: "codex",
			codingSdkSessionId: "code-1",
			timestamp: 400,
		});
		api.linkChatCodingSession({
			chatAgentId: "agent-railly",
			chatProviderId: "claude",
			chatSdkSessionId: "chat-session",
			codingProviderId: "codex",
			codingSdkSessionId: "code-2",
			timestamp: 500,
		});

		const result = await api.listChatCodingSessions({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: "chat-session",
		});
		expect(result.sessions.map((session) => session.sdkSessionId)).toEqual([
			"code-2",
			"code-1",
		]);
		expect(result.sessions[0]).toMatchObject({
			providerId: "codex",
			sdkSessionId: "code-2",
			title: "Second coding task",
			cwd: join(root, "workspace"),
		});

		links.close();
		codingStore.close();
		codingSharedStore.close();
		chatStore.close();
	});

	test("reads coding session detail by provider session identity", async () => {
		const root = createTempDir("outclaw-browser-coding-session-detail-api-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		mkdirSync(agentHomeDir, { recursive: true });

		const store = new SessionStore(dbPath, {
			agentId: CODING_STORAGE_OWNER_ID,
		});
		const codingStore = new CodingSessionStore(dbPath);
		store.upsert({
			providerId: "codex",
			sdkSessionId: "code-detail",
			ocSessionId: "oc-code-detail",
			title: "Implement detail route",
			model: "gpt-5.5",
			source: "code",
			tag: "code",
			timestamp: 100,
		});
		codingStore.upsert({
			providerId: "codex",
			sdkSessionId: "code-detail",
			cwd: join(root, "workspace"),
			browserTabId: "tab-code-detail",
			runStatus: "idle",
			timestamp: 150,
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
			codingSessions: codingStore,
			getRememberedAgentId: () => "agent-railly",
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map([["agent-railly", store]]),
		});

		await expect(api.getCodingSession("codex", "code-detail")).resolves.toEqual(
			{
				providerId: "codex",
				sdkSessionId: "code-detail",
				ocSessionId: "oc-code-detail",
				title: "Implement detail route",
				model: "gpt-5.5",
				lastActive: 150,
				cwd: join(root, "workspace"),
				lifecycleStatus: "open",
				runStatus: "idle",
				createdAt: 150,
				source: "code",
				tag: "code",
				browserTabId: "tab-code-detail",
			},
		);

		codingStore.close();
		store.close();
	});

	test("hydrates coding session detail with provider-owned event history", async () => {
		const root = createTempDir("outclaw-browser-coding-session-detail-events-");
		cleanupPaths.push(root);
		const dbPath = join(root, "db.sqlite");

		const store = new SessionStore(dbPath, {
			agentId: CODING_STORAGE_OWNER_ID,
		});
		const codingStore = new CodingSessionStore(dbPath);
		store.upsert({
			providerId: "codex",
			sdkSessionId: "code-detail",
			title: "Implement detail route",
			model: "gpt-5.5",
			source: "code",
			tag: "code",
			timestamp: 100,
		});
		codingStore.upsert({
			providerId: "codex",
			sdkSessionId: "code-detail",
			cwd: join(root, "workspace"),
			runStatus: "idle",
			timestamp: 150,
		});

		const api = createBrowserApi({
			agents: [],
			coding: {
				startPrompt: async () => ({
					status: "rejected",
					message: "unused",
				}),
				resumePrompt: async () => ({
					status: "rejected",
					message: "unused",
				}),
				stopPrompt: unusedStopPrompt,
				rehydrateSessionEvents: async () => [
					{ type: "user_prompt", text: "show history" },
					{ type: "text", text: "loaded", sessionId: "code-detail" },
				],
			},
			codingSessions: codingStore,
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map(),
		});

		await expect(
			api.getCodingSession("codex", "code-detail"),
		).resolves.toMatchObject({
			events: [
				{
					providerId: "codex",
					sdkSessionId: "code-detail",
					sequence: 1,
					event: { type: "user_prompt", text: "show history" },
				},
				{
					providerId: "codex",
					sdkSessionId: "code-detail",
					sequence: 2,
					event: {
						type: "text",
						text: "loaded",
						sessionId: "code-detail",
					},
				},
			],
		});

		codingStore.close();
		store.close();
	});

	test("reports idle coding session status with the latest final assistant response", async () => {
		const root = createTempDir("outclaw-browser-coding-session-status-api-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const sessionStore = new SessionStore(dbPath, {
			agentId: CODING_STORAGE_OWNER_ID,
		});
		const codingStore = new CodingSessionStore(dbPath);
		sessionStore.upsert({
			providerId: "codex",
			sdkSessionId: "code-status",
			title: "Status me",
			model: "gpt-5.5",
			source: "code",
			tag: "code",
			timestamp: 100,
		});
		codingStore.upsert({
			providerId: "codex",
			sdkSessionId: "code-status",
			cwd: join(root, "workspace"),
			runStatus: "idle",
			timestamp: 100,
		});
		const api = createBrowserApi({
			agents: [],
			coding: {
				startPrompt: async () => ({
					status: "rejected",
					message: "unused",
				}),
				resumePrompt: async () => ({
					status: "rejected",
					message: "unused",
				}),
				stopPrompt: unusedStopPrompt,
				rehydrateSessionEvents: async () => [
					{ type: "user_prompt", text: "first", sessionId: "code-status" },
					{ type: "text", text: "old answer", sessionId: "code-status" },
					{ type: "done", sessionId: "code-status", durationMs: 5 },
					{ type: "user_prompt", text: "follow up", sessionId: "code-status" },
					{ type: "thinking", text: "hidden work", sessionId: "code-status" },
					{ type: "text", text: "final", sessionId: "code-status" },
					{ type: "text", text: " answer", sessionId: "code-status" },
					{ type: "done", sessionId: "code-status", durationMs: 7 },
				],
			},
			codingSessions: codingStore,
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map(),
		});

		await expect(
			api.getCodingSessionStatus("codex", "code-status"),
		).resolves.toEqual({
			providerId: "codex",
			sdkSessionId: "code-status",
			ref: "codex/code-status",
			state: "done",
			repo: join(root, "workspace"),
			startedAt: "1970-01-01T00:00:00.100Z",
			lastEventAt: "1970-01-01T00:00:00.100Z",
			durationMs: 0,
			lastPrompt: "follow up",
			finalResponse: "final answer",
		});

		codingStore.close();
		sessionStore.close();
	});

	test("reports active and failed coding session status without reading history", async () => {
		const root = createTempDir(
			"outclaw-browser-coding-session-live-status-api-",
		);
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const sessionStore = new SessionStore(dbPath, {
			agentId: CODING_STORAGE_OWNER_ID,
		});
		const codingStore = new CodingSessionStore(dbPath);
		for (const sdkSessionId of ["code-running", "code-failed"]) {
			sessionStore.upsert({
				providerId: "codex",
				sdkSessionId,
				title: sdkSessionId,
				model: "gpt-5.5",
				source: "code",
				tag: "code",
				timestamp: 100,
			});
			codingStore.upsert({
				providerId: "codex",
				sdkSessionId,
				cwd: join(root, "workspace"),
				runStatus: "idle",
				timestamp: 100,
			});
		}
		codingStore.markRunning({
			providerId: "codex",
			sdkSessionId: "code-running",
		});
		codingStore.markFailed({
			providerId: "codex",
			sdkSessionId: "code-failed",
			message: "boom",
		});
		const api = createBrowserApi({
			agents: [],
			coding: {
				startPrompt: async () => ({
					status: "rejected",
					message: "unused",
				}),
				resumePrompt: async () => ({
					status: "rejected",
					message: "unused",
				}),
				stopPrompt: unusedStopPrompt,
				rehydrateSessionEvents: async () => {
					throw new Error("history should not be read");
				},
			},
			codingSessions: codingStore,
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map(),
		});

		await expect(
			api.getCodingSessionStatus("codex", "code-running"),
		).resolves.toEqual({
			providerId: "codex",
			sdkSessionId: "code-running",
			ref: "codex/code-running",
			state: "running",
			repo: join(root, "workspace"),
			startedAt: expect.any(String),
			lastEventAt: expect.any(String),
			durationMs: expect.any(Number),
		});
		await expect(
			api.getCodingSessionStatus("codex", "code-failed"),
		).resolves.toEqual({
			providerId: "codex",
			sdkSessionId: "code-failed",
			ref: "codex/code-failed",
			state: "error",
			repo: join(root, "workspace"),
			startedAt: expect.any(String),
			lastEventAt: expect.any(String),
			durationMs: expect.any(Number),
			error: { message: "boom" },
		});

		codingStore.close();
		sessionStore.close();
	});

	test("reports cancelled coding session status", async () => {
		const root = createTempDir(
			"outclaw-browser-coding-session-cancelled-status-api-",
		);
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const sessionStore = new SessionStore(dbPath, {
			agentId: CODING_STORAGE_OWNER_ID,
		});
		const codingStore = new CodingSessionStore(dbPath);
		sessionStore.upsert({
			providerId: "codex",
			sdkSessionId: "code-cancelled",
			title: "code-cancelled",
			model: "gpt-5.5",
			source: "code",
			tag: "code",
			timestamp: 100,
		});
		codingStore.upsert({
			providerId: "codex",
			sdkSessionId: "code-cancelled",
			cwd: join(root, "workspace"),
			runStatus: "running",
			timestamp: 100,
		});
		codingStore.markCancelled({
			providerId: "codex",
			sdkSessionId: "code-cancelled",
			timestamp: 300,
		});
		const api = createBrowserApi({
			agents: [],
			codingSessions: codingStore,
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map(),
		});

		await expect(
			api.getCodingSessionStatus("codex", "code-cancelled"),
		).resolves.toEqual({
			providerId: "codex",
			sdkSessionId: "code-cancelled",
			ref: "codex/code-cancelled",
			state: "cancelled",
			repo: join(root, "workspace"),
			startedAt: "1970-01-01T00:00:00.100Z",
			lastEventAt: "1970-01-01T00:00:00.300Z",
			durationMs: 200,
		});

		codingStore.close();
		sessionStore.close();
	});

	test("deletes coding sessions through the daemon coding store", async () => {
		const root = createTempDir("outclaw-browser-coding-session-delete-api-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		mkdirSync(agentHomeDir, { recursive: true });

		const store = new SessionStore(dbPath, {
			agentId: CODING_STORAGE_OWNER_ID,
		});
		const codingStore = new CodingSessionStore(dbPath);
		store.upsert({
			providerId: "codex",
			sdkSessionId: "code-delete",
			title: "Delete me",
			model: "gpt-5.5",
			source: "code",
			tag: "code",
			timestamp: 100,
		});
		codingStore.upsert({
			providerId: "codex",
			sdkSessionId: "code-delete",
			cwd: join(root, "workspace"),
			runStatus: "idle",
			timestamp: 100,
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
			codingSessions: codingStore,
			getRememberedAgentId: () => "agent-railly",
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map([["agent-railly", store]]),
		});

		await expect(
			api.deleteCodingSession("codex", "code-delete"),
		).resolves.toEqual({
			deleted: true,
			providerId: "codex",
			sdkSessionId: "code-delete",
		});
		await expect(api.getCodingSession("codex", "code-delete")).rejects.toThrow(
			"Unknown coding session: codex/code-delete",
		);
		expect(store.get("codex", "code-delete")).toBeUndefined();

		codingStore.close();
		store.close();
	});

	test("archives and restores coding sessions through the daemon coding store", async () => {
		const root = createTempDir("outclaw-browser-coding-session-archive-api-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		mkdirSync(agentHomeDir, { recursive: true });

		const store = new SessionStore(dbPath, {
			agentId: CODING_STORAGE_OWNER_ID,
		});
		const codingStore = new CodingSessionStore(dbPath);
		store.upsert({
			providerId: "codex",
			sdkSessionId: "code-archive",
			title: "Archive me",
			model: "gpt-5.5",
			source: "code",
			tag: "code",
			timestamp: 100,
		});
		codingStore.upsert({
			providerId: "codex",
			sdkSessionId: "code-archive",
			cwd: join(root, "workspace"),
			runStatus: "idle",
			timestamp: 100,
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
			codingSessions: codingStore,
			getRememberedAgentId: () => "agent-railly",
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map([["agent-railly", store]]),
		});

		await expect(
			api.archiveCodingSession("codex", "code-archive"),
		).resolves.toMatchObject({
			archived: true,
			session: {
				providerId: "codex",
				sdkSessionId: "code-archive",
				lifecycleStatus: "archived",
			},
		});
		expect(store.get("codex", "code-archive")).toBeDefined();
		await expect(api.listCodingSessions({ limit: 10 })).resolves.toEqual({
			sessions: [],
		});
		await expect(
			api.listCodingSessions({
				limit: 10,
				lifecycleStatus: "archived",
			}),
		).resolves.toMatchObject({
			sessions: [
				{
					sdkSessionId: "code-archive",
					lifecycleStatus: "archived",
				},
			],
		});

		await expect(
			api.restoreCodingSession("codex", "code-archive"),
		).resolves.toMatchObject({
			restored: true,
			session: {
				providerId: "codex",
				sdkSessionId: "code-archive",
				lifecycleStatus: "open",
			},
		});
		await expect(api.listCodingSessions({ limit: 10 })).resolves.toMatchObject({
			sessions: [
				{
					sdkSessionId: "code-archive",
					lifecycleStatus: "open",
				},
			],
		});

		codingStore.close();
		store.close();
	});

	test("walks the full lifecycle (archive, trash, restore, repo-trash cascade) on a fresh DB", async () => {
		// This is the belt-and-suspenders smoke test for the wipe-and-restart
		// upgrade path: build a fresh DB, register a repo, run a few sessions
		// through every lifecycle state, and verify the lists reflect the
		// transitions without any migration step.
		const root = createTempDir("outclaw-browser-coding-lifecycle-smoke-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		mkdirSync(agentHomeDir, { recursive: true });

		const store = new SessionStore(dbPath, {
			agentId: CODING_STORAGE_OWNER_ID,
		});
		const codingStore = new CodingSessionStore(dbPath);
		const codingRepositories = new CodingRepositoryStore(dbPath);

		const repoRoot = mkdtempSync(
			join(tmpdir(), "outclaw-coding-lifecycle-repo-"),
		);
		// Use realistic timestamps so the 30-day trash-purge sweep that runs on
		// every trashed list doesn't immediately wipe the fixture sessions.
		const now = Date.now();
		const repo = codingRepositories.register({
			displayName: "lifecycle-repo",
			rootCwd: repoRoot,
			source: "manual",
			timestamp: now - 1_000,
		});

		for (const id of ["session-a", "session-b"]) {
			store.upsert({
				providerId: "codex",
				sdkSessionId: id,
				title: `Title ${id}`,
				model: "gpt-5.5",
				source: "code",
				tag: "code",
				timestamp: now,
			});
			codingStore.upsert({
				providerId: "codex",
				sdkSessionId: id,
				cwd: repoRoot,
				repositoryId: repo.id,
				runStatus: "idle",
				timestamp: now,
			});
		}

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
			codingRepositories,
			codingSessions: codingStore,
			getRememberedAgentId: () => "agent-railly",
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map([["agent-railly", store]]),
		});

		// 1. Archive one session.
		await expect(
			api.archiveCodingSession("codex", "session-a"),
		).resolves.toMatchObject({
			archived: true,
			session: { lifecycleStatus: "archived" },
		});

		// 2. Trash the other.
		await expect(
			api.trashCodingSession("codex", "session-b"),
		).resolves.toMatchObject({
			trashed: true,
			session: { lifecycleStatus: "trashed" },
		});

		await expect(api.listCodingSessions({ limit: 10 })).resolves.toEqual({
			sessions: [],
		});
		await expect(
			api.listCodingSessions({ limit: 10, lifecycleStatus: "archived" }),
		).resolves.toMatchObject({
			sessions: [{ sdkSessionId: "session-a" }],
		});
		await expect(
			api.listCodingSessions({ limit: 10, lifecycleStatus: "trashed" }),
		).resolves.toMatchObject({
			sessions: [{ sdkSessionId: "session-b" }],
		});

		// 3. Restore both sessions back to open.
		await expect(
			api.restoreCodingSession("codex", "session-a"),
		).resolves.toMatchObject({
			restored: true,
			session: { lifecycleStatus: "open" },
		});
		await expect(
			api.restoreCodingSession("codex", "session-b"),
		).resolves.toMatchObject({
			restored: true,
			session: { lifecycleStatus: "open" },
		});

		// 4. Trash the repo. Cascade should send both sessions to trash.
		await expect(api.trashCodingRepository(repo.id)).resolves.toMatchObject({
			trashed: true,
			repository: { status: "trashed" },
		});
		const trashedPage = await api.listCodingSessions({
			limit: 10,
			lifecycleStatus: "trashed",
		});
		expect(
			trashedPage.sessions.map((session) => session.sdkSessionId).sort(),
		).toEqual(["session-a", "session-b"]);

		// 5. Restore the repo. Sessions stay trashed (one-way cascade), but the
		//    repo itself is active again.
		await expect(api.restoreCodingRepository(repo.id)).resolves.toMatchObject({
			restored: true,
			repository: { status: "active" },
		});
		const stillTrashed = await api.listCodingSessions({
			limit: 10,
			lifecycleStatus: "trashed",
		});
		expect(stillTrashed.sessions.length).toBe(2);

		codingRepositories.close();
		codingStore.close();
		store.close();
	});

	test("syncs coding session archive, restore, and rename with the provider before local mutation", async () => {
		const root = createTempDir("outclaw-browser-coding-provider-sync-api-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		mkdirSync(agentHomeDir, { recursive: true });

		const store = new SessionStore(dbPath, {
			agentId: CODING_STORAGE_OWNER_ID,
		});
		const codingStore = new CodingSessionStore(dbPath);
		store.upsert({
			providerId: "codex",
			sdkSessionId: "code-sync",
			title: "Sync me",
			model: "gpt-5.5",
			source: "code",
			tag: "code",
			timestamp: 100,
		});
		codingStore.upsert({
			providerId: "codex",
			sdkSessionId: "code-sync",
			cwd: join(root, "workspace"),
			runStatus: "idle",
			timestamp: 100,
		});
		const providerCalls: string[] = [];
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
			coding: {
				startPrompt: async () => ({ status: "rejected", message: "unused" }),
				resumePrompt: async () => ({ status: "rejected", message: "unused" }),
				stopPrompt: unusedStopPrompt,
				archiveSession: async ({ sdkSessionId }) => {
					providerCalls.push(`archive:${sdkSessionId}`);
				},
				restoreSession: async ({ sdkSessionId }) => {
					providerCalls.push(`restore:${sdkSessionId}`);
				},
				renameSession: async ({ sdkSessionId, title }) => {
					providerCalls.push(`rename:${sdkSessionId}:${title}`);
				},
			},
			codingSessions: codingStore,
			getRememberedAgentId: () => "agent-railly",
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map([["agent-railly", store]]),
		});

		await api.archiveCodingSession("codex", "code-sync");
		await api.restoreCodingSession("codex", "code-sync");
		await api.renameCodingSession("codex", "code-sync", "Renamed sync");

		expect(providerCalls).toEqual([
			"archive:code-sync",
			"restore:code-sync",
			"rename:code-sync:Renamed sync",
		]);
		expect(codingStore.getDetail("codex", "code-sync")).toMatchObject({
			lifecycleStatus: "open",
			title: "Renamed sync",
		});

		codingStore.close();
		store.close();
	});

	test("does not mutate local coding session state when provider sync fails", async () => {
		const root = createTempDir(
			"outclaw-browser-coding-provider-sync-failure-api-",
		);
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		mkdirSync(agentHomeDir, { recursive: true });

		const store = new SessionStore(dbPath, {
			agentId: CODING_STORAGE_OWNER_ID,
		});
		const codingStore = new CodingSessionStore(dbPath);
		store.upsert({
			providerId: "codex",
			sdkSessionId: "code-sync",
			title: "Original title",
			model: "gpt-5.5",
			source: "code",
			tag: "code",
			timestamp: 100,
		});
		codingStore.upsert({
			providerId: "codex",
			sdkSessionId: "code-sync",
			cwd: join(root, "workspace"),
			runStatus: "idle",
			timestamp: 100,
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
			coding: {
				startPrompt: async () => ({ status: "rejected", message: "unused" }),
				resumePrompt: async () => ({ status: "rejected", message: "unused" }),
				stopPrompt: unusedStopPrompt,
				archiveSession: async () => {
					throw new Error("provider archive failed");
				},
				restoreSession: async () => {
					throw new Error("provider restore failed");
				},
				renameSession: async () => {
					throw new Error("provider rename failed");
				},
			},
			codingSessions: codingStore,
			getRememberedAgentId: () => "agent-railly",
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map([["agent-railly", store]]),
		});

		await expect(
			api.archiveCodingSession("codex", "code-sync"),
		).rejects.toThrow("provider archive failed");
		expect(codingStore.getDetail("codex", "code-sync")).toMatchObject({
			lifecycleStatus: "open",
			title: "Original title",
		});

		codingStore.archive("codex", "code-sync");
		await expect(
			api.restoreCodingSession("codex", "code-sync"),
		).rejects.toThrow("provider restore failed");
		expect(codingStore.getDetail("codex", "code-sync")).toMatchObject({
			lifecycleStatus: "archived",
			title: "Original title",
		});

		await expect(
			api.renameCodingSession("codex", "code-sync", "Should not save"),
		).rejects.toThrow("provider rename failed");
		expect(codingStore.getDetail("codex", "code-sync")).toMatchObject({
			lifecycleStatus: "archived",
			title: "Original title",
		});

		codingStore.close();
		store.close();
	});

	test("reconciles known coding sessions before listing archived sessions", async () => {
		const root = createTempDir("outclaw-browser-coding-reconcile-list-api-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const store = new SessionStore(dbPath, {
			agentId: CODING_STORAGE_OWNER_ID,
		});
		const codingStore = new CodingSessionStore(dbPath);
		store.upsert({
			providerId: "codex",
			sdkSessionId: "known-thread",
			title: "Original title",
			model: "gpt-5.5",
			source: "code",
			tag: "code",
			timestamp: 100,
		});
		codingStore.upsert({
			providerId: "codex",
			sdkSessionId: "known-thread",
			cwd: join(root, "workspace"),
			runStatus: "idle",
			timestamp: 100,
		});
		const reconciled: string[][] = [];
		const api = createBrowserApi({
			agents: [],
			coding: {
				startPrompt: async () => ({ status: "rejected", message: "unused" }),
				resumePrompt: async () => ({ status: "rejected", message: "unused" }),
				stopPrompt: unusedStopPrompt,
				reconcileSessions: async ({ sdkSessionIds }) => {
					reconciled.push(sdkSessionIds);
					codingStore.archive("codex", "known-thread");
					codingStore.rename("codex", "known-thread", "Archived elsewhere");
				},
			},
			codingSessions: codingStore,
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map(),
		});

		await expect(
			api.listCodingSessions({ lifecycleStatus: "archived", limit: 10 }),
		).resolves.toMatchObject({
			sessions: [
				{
					providerId: "codex",
					sdkSessionId: "known-thread",
					lifecycleStatus: "archived",
					title: "Archived elsewhere",
				},
			],
		});
		expect(reconciled).toEqual([["known-thread"]]);

		codingStore.close();
		store.close();
	});

	test("keeps local coding session lists available when reconciliation fails", async () => {
		const root = createTempDir(
			"outclaw-browser-coding-reconcile-failure-list-api-",
		);
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const store = new SessionStore(dbPath, {
			agentId: CODING_STORAGE_OWNER_ID,
		});
		const codingStore = new CodingSessionStore(dbPath);
		store.upsert({
			providerId: "codex",
			sdkSessionId: "known-thread",
			title: "Local title",
			model: "gpt-5.5",
			source: "code",
			tag: "code",
			timestamp: 100,
		});
		codingStore.upsert({
			providerId: "codex",
			sdkSessionId: "known-thread",
			cwd: join(root, "workspace"),
			runStatus: "idle",
			timestamp: 100,
		});
		const api = createBrowserApi({
			agents: [],
			coding: {
				startPrompt: async () => ({ status: "rejected", message: "unused" }),
				resumePrompt: async () => ({ status: "rejected", message: "unused" }),
				stopPrompt: unusedStopPrompt,
				reconcileSessions: async () => {
					throw new Error("provider unavailable");
				},
			},
			codingSessions: codingStore,
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map(),
		});

		await expect(api.listCodingSessions({ limit: 10 })).resolves.toMatchObject({
			sessions: [
				{
					providerId: "codex",
					sdkSessionId: "known-thread",
					title: "Local title",
				},
			],
		});

		codingStore.close();
		store.close();
	});

	test("manages coding repositories through the browser API", async () => {
		const root = createTempDir("outclaw-browser-coding-repos-api-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		const repoRoot = join(root, "repos", "outclaw");
		mkdirSync(agentHomeDir, { recursive: true });
		mkdirSync(repoRoot, { recursive: true });

		const store = new SessionStore(dbPath, { agentId: "agent-railly" });
		const repositories = new CodingRepositoryStore(dbPath);
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
			codingRepositories: repositories,
			getRememberedAgentId: () => "agent-railly",
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map([["agent-railly", store]]),
		});

		const registered = await api.registerCodingRepository({
			rootCwd: repoRoot,
		});
		expect(registered).toMatchObject({
			displayName: "outclaw",
			rootCwd: realpathSync(repoRoot),
			source: "manual",
			status: "active",
		});
		await expect(api.listCodingRepositories()).resolves.toEqual({
			repositories: [registered],
		});
		await expect(api.getCodingRepository(registered.id)).resolves.toEqual(
			registered,
		);
		await expect(
			api.writeCodingRepositoryTerminalRunCommand(
				registered.id,
				"  bun run check  ",
			),
		).resolves.toEqual({
			command: "bun run check",
		});
		await expect(api.getCodingRepository(registered.id)).resolves.toMatchObject(
			{
				id: registered.id,
				terminalRunCommand: "bun run check",
			},
		);

		await expect(api.archiveCodingRepository(registered.id)).resolves.toEqual({
			archived: true,
			repository: {
				...registered,
				terminalRunCommand: "bun run check",
				status: "archived",
			},
		});
		await expect(api.listCodingRepositories()).resolves.toEqual({
			repositories: [],
		});
		await expect(
			api.listCodingRepositories({ includeArchived: true }),
		).resolves.toMatchObject({
			repositories: [
				{
					id: registered.id,
					status: "archived",
				},
			],
		});
		await expect(api.restoreCodingRepository(registered.id)).resolves.toEqual({
			restored: true,
			repository: {
				...registered,
				terminalRunCommand: "bun run check",
				status: "active",
				lastActive: expect.any(Number),
			},
		});
		await expect(api.listCodingRepositories()).resolves.toMatchObject({
			repositories: [
				{
					id: registered.id,
					status: "active",
				},
			],
		});

		repositories.close();
		store.close();
	});

	test("clones a coding repository and registers it through the browser API", async () => {
		const root = createTempDir("outclaw-browser-coding-clone-api-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		const parentDir = join(root, "checkouts");
		mkdirSync(agentHomeDir, { recursive: true });
		mkdirSync(parentDir, { recursive: true });

		const store = new SessionStore(dbPath, { agentId: "agent-railly" });
		const repositories = new CodingRepositoryStore(dbPath);

		const cloneCalls: Array<{ remoteUrl: string; parentDir: string }> = [];
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
			cloneCodingRepository: async ({ remoteUrl, parentDir: dir }) => {
				cloneCalls.push({ remoteUrl, parentDir: dir });
				const cloned = join(dir, "outclaw");
				mkdirSync(cloned, { recursive: true });
				return {
					status: "cloned",
					rootCwd: cloned,
					displayName: "outclaw",
				};
			},
			codingRepositories: repositories,
			getRememberedAgentId: () => "agent-railly",
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map([["agent-railly", store]]),
		});

		const response = await api.cloneCodingRepository({
			remoteUrl: "https://example.com/foo/outclaw.git",
			parentDir,
		});

		expect(cloneCalls).toEqual([
			{
				remoteUrl: "https://example.com/foo/outclaw.git",
				parentDir,
			},
		]);
		expect(response).toMatchObject({
			status: "cloned",
			repository: {
				displayName: "outclaw",
				rootCwd: realpathSync(join(parentDir, "outclaw")),
				remoteUrl: "https://example.com/foo/outclaw.git",
				source: "clone",
				status: "active",
			},
		});
		await expect(api.listCodingRepositories()).resolves.toMatchObject({
			repositories: [{ source: "clone" }],
		});

		repositories.close();
		store.close();
	});

	test("propagates clone failures without touching the repository store", async () => {
		const root = createTempDir("outclaw-browser-coding-clone-fail-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		mkdirSync(agentHomeDir, { recursive: true });

		const store = new SessionStore(dbPath, { agentId: "agent-railly" });
		const repositories = new CodingRepositoryStore(dbPath);

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
			cloneCodingRepository: async () => ({
				status: "failed",
				message: "fatal: repository not found",
			}),
			codingRepositories: repositories,
			getRememberedAgentId: () => "agent-railly",
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map([["agent-railly", store]]),
		});

		await expect(
			api.cloneCodingRepository({
				remoteUrl: "https://example.com/foo/missing.git",
				parentDir: "/tmp/parent",
			}),
		).resolves.toEqual({
			status: "failed",
			message: "fatal: repository not found",
		});
		await expect(api.listCodingRepositories()).resolves.toEqual({
			repositories: [],
		});

		repositories.close();
		store.close();
	});

	test("starts a coding session through the daemon coding service by repository id", async () => {
		const root = createTempDir("outclaw-browser-coding-start-");
		cleanupPaths.push(root);
		const dbPath = join(root, "db.sqlite");
		const repoRoot = join(root, "repos", "outclaw");
		mkdirSync(repoRoot, { recursive: true });

		const repositories = new CodingRepositoryStore(dbPath);
		const registered = repositories.register({
			rootCwd: repoRoot,
			source: "manual",
		});

		const calls: Array<{ cwd: string; prompt: string }> = [];
		const api = createBrowserApi({
			agents: [],
			coding: {
				async startPrompt(params) {
					calls.push({ cwd: params.cwd, prompt: params.prompt });
					return {
						status: "accepted",
						providerId: "codex",
						sdkSessionId: "codex-thread-1",
					};
				},
				async resumePrompt() {
					throw new Error("resume should not be called");
				},
				stopPrompt: unusedStopPrompt,
			},
			codingRepositories: repositories,
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map(),
		});

		await expect(
			api.startCodingSession({
				repositoryId: registered.id,
				prompt: "fix the tests",
			}),
		).resolves.toEqual({
			status: "accepted",
			providerId: "codex",
			sdkSessionId: "codex-thread-1",
		});
		expect(calls).toEqual([
			{ cwd: registered.rootCwd, prompt: "fix the tests" },
		]);

		repositories.close();
	});

	test("rejects starting a coding session with an explicit cwd outside the chosen repository", async () => {
		const root = createTempDir("outclaw-browser-coding-start-outside-");
		cleanupPaths.push(root);
		const dbPath = join(root, "db.sqlite");
		const repoRoot = join(root, "repos", "outclaw");
		const elsewhere = join(root, "elsewhere");
		mkdirSync(repoRoot, { recursive: true });
		mkdirSync(elsewhere, { recursive: true });

		const repositories = new CodingRepositoryStore(dbPath);
		const registered = repositories.register({
			rootCwd: repoRoot,
			source: "manual",
		});

		const calls: Array<{ cwd: string }> = [];
		const api = createBrowserApi({
			agents: [],
			coding: {
				async startPrompt(params) {
					calls.push({ cwd: params.cwd });
					return {
						status: "accepted",
						providerId: "codex",
						sdkSessionId: "codex-thread-1",
					};
				},
				async resumePrompt() {
					throw new Error("resume should not be called");
				},
				stopPrompt: unusedStopPrompt,
			},
			codingRepositories: repositories,
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map(),
		});

		await expect(
			api.startCodingSession({
				repositoryId: registered.id,
				cwd: elsewhere,
				prompt: "fix the tests",
			}),
		).resolves.toEqual({
			status: "rejected",
			message: `Coding session cwd must be within repository root: ${registered.rootCwd}`,
		});
		expect(calls).toEqual([]);

		repositories.close();
	});

	test("accepts an explicit cwd that is a subdirectory of the chosen repository", async () => {
		const root = createTempDir("outclaw-browser-coding-start-subdir-");
		cleanupPaths.push(root);
		const dbPath = join(root, "db.sqlite");
		const repoRoot = join(root, "repos", "outclaw");
		const subdir = join(repoRoot, "packages", "app");
		mkdirSync(subdir, { recursive: true });

		const repositories = new CodingRepositoryStore(dbPath);
		const registered = repositories.register({
			rootCwd: repoRoot,
			source: "manual",
		});

		const calls: Array<{ cwd: string }> = [];
		const api = createBrowserApi({
			agents: [],
			coding: {
				async startPrompt(params) {
					calls.push({ cwd: params.cwd });
					return {
						status: "accepted",
						providerId: "codex",
						sdkSessionId: "codex-thread-1",
					};
				},
				async resumePrompt() {
					throw new Error("resume should not be called");
				},
				stopPrompt: unusedStopPrompt,
			},
			codingRepositories: repositories,
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map(),
		});

		await expect(
			api.startCodingSession({
				repositoryId: registered.id,
				cwd: subdir,
				prompt: "fix the tests",
			}),
		).resolves.toMatchObject({ status: "accepted" });
		expect(calls).toEqual([{ cwd: subdir }]);

		repositories.close();
	});

	test("rejects starting a coding session without a repository or cwd", async () => {
		const root = createTempDir("outclaw-browser-coding-start-invalid-");
		cleanupPaths.push(root);
		const api = createBrowserApi({
			agents: [],
			coding: {
				async startPrompt() {
					throw new Error("should not be called");
				},
				async resumePrompt() {
					throw new Error("should not be called");
				},
				stopPrompt: unusedStopPrompt,
			},
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map(),
		});

		await expect(
			api.startCodingSession({ prompt: "anything" }),
		).resolves.toEqual({
			status: "rejected",
			message:
				"Coding session start requires either a repository id or an explicit cwd",
		});
	});

	test("resumes a coding session by provider session identity", async () => {
		const root = createTempDir("outclaw-browser-coding-resume-");
		cleanupPaths.push(root);
		const calls: Array<{
			providerId: string;
			sdkSessionId: string;
			prompt: string;
		}> = [];
		const api = createBrowserApi({
			agents: [],
			coding: {
				async startPrompt() {
					throw new Error("start should not be called");
				},
				async resumePrompt(params) {
					calls.push({
						providerId: params.providerId ?? "",
						sdkSessionId: params.sdkSessionId,
						prompt: params.prompt,
					});
					return {
						status: "accepted",
						providerId: params.providerId ?? "codex",
						sdkSessionId: params.sdkSessionId,
					};
				},
				stopPrompt: unusedStopPrompt,
			},
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map(),
		});

		await expect(
			api.resumeCodingSession({
				providerId: "codex",
				sdkSessionId: "codex-thread-1",
				prompt: "follow up",
			}),
		).resolves.toEqual({
			status: "accepted",
			providerId: "codex",
			sdkSessionId: "codex-thread-1",
		});
		expect(calls).toEqual([
			{
				providerId: "codex",
				sdkSessionId: "codex-thread-1",
				prompt: "follow up",
			},
		]);
	});

	test("auto-restores an archived coding session before resuming it", async () => {
		const root = createTempDir("outclaw-browser-coding-resume-archived-");
		cleanupPaths.push(root);
		const dbPath = join(root, "db.sqlite");
		const sessionStore = new SessionStore(dbPath, {
			agentId: CODING_STORAGE_OWNER_ID,
		});
		const codingStore = new CodingSessionStore(dbPath);
		const calls: string[] = [];

		sessionStore.upsert({
			providerId: "codex",
			sdkSessionId: "archived-thread-1",
			title: "Archived work",
			model: "gpt-5.5",
			source: "code",
			tag: "code",
			timestamp: 100,
		});
		codingStore.upsert({
			providerId: "codex",
			sdkSessionId: "archived-thread-1",
			cwd: join(root, "workspace"),
			lifecycleStatus: "archived",
			runStatus: "idle",
			timestamp: 100,
		});

		const api = createBrowserApi({
			agents: [],
			coding: {
				async startPrompt() {
					throw new Error("start should not be called");
				},
				async resumePrompt(params) {
					calls.push(
						`resume:${params.providerId ?? ""}/${params.sdkSessionId}:${params.prompt}`,
					);
					return {
						status: "accepted",
						providerId: params.providerId ?? "codex",
						sdkSessionId: params.sdkSessionId,
					};
				},
				async restoreSession(params) {
					calls.push(`restore:${params.providerId}/${params.sdkSessionId}`);
				},
				stopPrompt: unusedStopPrompt,
			},
			codingSessions: codingStore,
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map(),
		});

		expect(
			codingStore.getDetail("codex", "archived-thread-1")?.lifecycleStatus,
		).toBe("archived");

		await expect(
			api.resumeCodingSession({
				providerId: "codex",
				sdkSessionId: "archived-thread-1",
				prompt: "follow up",
			}),
		).resolves.toEqual({
			status: "accepted",
			providerId: "codex",
			sdkSessionId: "archived-thread-1",
		});

		expect(calls).toEqual([
			"restore:codex/archived-thread-1",
			"resume:codex/archived-thread-1:follow up",
		]);
		expect(
			codingStore.getDetail("codex", "archived-thread-1")?.lifecycleStatus,
		).toBe("open");

		codingStore.close();
		sessionStore.close();
	});

	test("reconciles externally archived coding sessions before resuming", async () => {
		const root = createTempDir(
			"outclaw-browser-coding-resume-reconcile-archived-",
		);
		cleanupPaths.push(root);
		const dbPath = join(root, "db.sqlite");
		const sessionStore = new SessionStore(dbPath, {
			agentId: CODING_STORAGE_OWNER_ID,
		});
		const codingStore = new CodingSessionStore(dbPath);
		const calls: string[] = [];

		sessionStore.upsert({
			providerId: "codex",
			sdkSessionId: "externally-archived-thread",
			title: "Externally archived work",
			model: "gpt-5.5",
			source: "code",
			tag: "code",
			timestamp: 100,
		});
		codingStore.upsert({
			providerId: "codex",
			sdkSessionId: "externally-archived-thread",
			cwd: join(root, "workspace"),
			runStatus: "idle",
			timestamp: 100,
		});

		const api = createBrowserApi({
			agents: [],
			coding: {
				async startPrompt() {
					throw new Error("start should not be called");
				},
				async resumePrompt(params) {
					calls.push(`resume:${params.providerId}/${params.sdkSessionId}`);
					return {
						status: "accepted",
						providerId: params.providerId ?? "codex",
						sdkSessionId: params.sdkSessionId,
					};
				},
				async restoreSession(params) {
					calls.push(`restore:${params.providerId}/${params.sdkSessionId}`);
				},
				async reconcileSessions(params) {
					calls.push(
						`reconcile:${params.providerId}/${params.sdkSessionIds.join(",")}`,
					);
					codingStore.archive("codex", "externally-archived-thread");
				},
				stopPrompt: unusedStopPrompt,
			},
			codingSessions: codingStore,
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map(),
		});

		await expect(
			api.resumeCodingSession({
				providerId: "codex",
				sdkSessionId: "externally-archived-thread",
				prompt: "follow up",
			}),
		).resolves.toEqual({
			status: "accepted",
			providerId: "codex",
			sdkSessionId: "externally-archived-thread",
		});

		expect(calls).toEqual([
			"reconcile:codex/externally-archived-thread",
			"restore:codex/externally-archived-thread",
			"resume:codex/externally-archived-thread",
		]);
		expect(
			codingStore.getDetail("codex", "externally-archived-thread")
				?.lifecycleStatus,
		).toBe("open");

		codingStore.close();
		sessionStore.close();
	});

	test("stops a coding session by provider session identity", async () => {
		const root = createTempDir("outclaw-browser-coding-stop-");
		cleanupPaths.push(root);
		const calls: Array<{
			providerId: string;
			sdkSessionId: string;
		}> = [];
		const api = createBrowserApi({
			agents: [],
			coding: {
				async startPrompt() {
					throw new Error("start should not be called");
				},
				async resumePrompt() {
					throw new Error("resume should not be called");
				},
				stopPrompt(params) {
					calls.push({
						providerId: params.providerId ?? "",
						sdkSessionId: params.sdkSessionId,
					});
					return {
						status: "accepted",
						providerId: params.providerId ?? "codex",
						sdkSessionId: params.sdkSessionId,
					};
				},
			},
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map(),
		});

		await expect(
			api.stopCodingSession({
				providerId: "codex",
				sdkSessionId: "codex-thread-1",
			}),
		).resolves.toEqual({
			status: "accepted",
			providerId: "codex",
			sdkSessionId: "codex-thread-1",
		});
		expect(calls).toEqual([
			{
				providerId: "codex",
				sdkSessionId: "codex-thread-1",
			},
		]);
	});

	test("uses cancellation semantics for browser stop requests when available", async () => {
		const root = createTempDir("outclaw-browser-coding-stop-cancel-");
		cleanupPaths.push(root);
		const calls: string[] = [];
		const api = createBrowserApi({
			agents: [],
			coding: {
				async startPrompt() {
					throw new Error("start should not be called");
				},
				async resumePrompt() {
					throw new Error("resume should not be called");
				},
				stopPrompt() {
					calls.push("stop");
					return {
						status: "rejected",
						message: "stop should not be called",
					};
				},
				cancelPrompt(params) {
					calls.push(`cancel:${params.providerId}/${params.sdkSessionId}`);
					return {
						status: "already_terminal",
						providerId: params.providerId ?? "codex",
						sdkSessionId: params.sdkSessionId,
						state: "cancelled",
					};
				},
			},
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map(),
		});

		await expect(
			api.stopCodingSession({
				providerId: "codex",
				sdkSessionId: "codex-thread-1",
			}),
		).resolves.toEqual({
			status: "accepted",
			providerId: "codex",
			sdkSessionId: "codex-thread-1",
		});
		expect(calls).toEqual(["cancel:codex/codex-thread-1"]);
	});

	test("cancels a coding session by provider session identity", async () => {
		const root = createTempDir("outclaw-browser-coding-cancel-");
		cleanupPaths.push(root);
		const calls: Array<{ providerId: string; sdkSessionId: string }> = [];
		const api = createBrowserApi({
			agents: [],
			coding: {
				async startPrompt() {
					throw new Error("start should not be called");
				},
				async resumePrompt() {
					throw new Error("resume should not be called");
				},
				stopPrompt: unusedStopPrompt,
				cancelPrompt(params) {
					calls.push({
						providerId: params.providerId ?? "",
						sdkSessionId: params.sdkSessionId,
					});
					return {
						status: "accepted",
						providerId: params.providerId ?? "codex",
						sdkSessionId: params.sdkSessionId,
					};
				},
			},
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map(),
		});

		await expect(
			api.cancelCodingSession({
				providerId: "codex",
				sdkSessionId: "codex-thread-1",
			}),
		).resolves.toEqual({
			status: "accepted",
			providerId: "codex",
			sdkSessionId: "codex-thread-1",
		});
		expect(calls).toEqual([
			{
				providerId: "codex",
				sdkSessionId: "codex-thread-1",
			},
		]);
	});

	test("forwards model and effort overrides into the coding service", async () => {
		const root = createTempDir("outclaw-browser-coding-model-effort-");
		cleanupPaths.push(root);
		const dbPath = join(root, "db.sqlite");
		const repoRoot = join(root, "repos", "outclaw");
		mkdirSync(repoRoot, { recursive: true });

		const repositories = new CodingRepositoryStore(dbPath);
		const registered = repositories.register({
			rootCwd: repoRoot,
			source: "manual",
		});

		const startCalls: Array<{ model?: string; effort?: string }> = [];
		const resumeCalls: Array<{ model?: string; effort?: string }> = [];
		const api = createBrowserApi({
			agents: [],
			coding: {
				async startPrompt(params) {
					startCalls.push({ model: params.model, effort: params.effort });
					return {
						status: "accepted",
						providerId: "codex",
						sdkSessionId: "codex-1",
					};
				},
				async resumePrompt(params) {
					resumeCalls.push({ model: params.model, effort: params.effort });
					return {
						status: "accepted",
						providerId: params.providerId ?? "codex",
						sdkSessionId: params.sdkSessionId,
					};
				},
				stopPrompt: unusedStopPrompt,
			},
			codingRepositories: repositories,
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map(),
		});

		await api.startCodingSession({
			repositoryId: registered.id,
			prompt: "do work",
			model: "gpt-5.5",
			effort: "high",
		});
		await api.resumeCodingSession({
			providerId: "codex",
			sdkSessionId: "codex-1",
			prompt: "more work",
			model: "gpt-5.4-mini",
			effort: "low",
		});

		expect(startCalls).toEqual([{ model: "gpt-5.5", effort: "high" }]);
		expect(resumeCalls).toEqual([{ model: "gpt-5.4-mini", effort: "low" }]);

		repositories.close();
	});

	test("lists coding models from the coding service", async () => {
		const root = createTempDir("outclaw-browser-coding-models-");
		cleanupPaths.push(root);
		const api = createBrowserApi({
			agents: [],
			coding: {
				async startPrompt() {
					throw new Error("not called");
				},
				async resumePrompt() {
					throw new Error("not called");
				},
				stopPrompt: unusedStopPrompt,
				async listModels() {
					return [
						{
							id: "gpt-5.5",
							model: "gpt-5.5",
							displayName: "GPT-5.5",
							description: "frontier",
							isDefault: true,
							defaultReasoningEffort: "medium",
							supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
							serviceTiers: [],
						},
					];
				},
			},
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map(),
		});

		await expect(api.listCodingModels()).resolves.toEqual({
			models: [
				{
					id: "gpt-5.5",
					model: "gpt-5.5",
					displayName: "GPT-5.5",
					description: "frontier",
					isDefault: true,
					defaultReasoningEffort: "medium",
					supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
					serviceTiers: [],
				},
			],
		});
	});

	test("lists coding repository skills from the coding service", async () => {
		const root = createTempDir("outclaw-browser-coding-skills-");
		cleanupPaths.push(root);
		const repositories = new CodingRepositoryStore(join(root, "coding.sqlite"));
		const repository = repositories.register({
			rootCwd: join(root, "repo"),
			displayName: "repo",
			source: "manual",
		});
		const calls: Array<{ cwd: string; forceReload?: boolean }> = [];
		const api = createBrowserApi({
			agents: [],
			coding: {
				async startPrompt() {
					throw new Error("not called");
				},
				async resumePrompt() {
					throw new Error("not called");
				},
				stopPrompt: unusedStopPrompt,
				async listSkills(params) {
					calls.push(params);
					return [
						{
							name: "review",
							description: "Review the branch",
							scope: "repo",
						},
					];
				},
			},
			codingRepositories: repositories,
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map(),
		});

		await expect(
			api.listCodingRepositorySkills(repository.id, { forceReload: true }),
		).resolves.toEqual({
			skills: [
				{
					name: "review",
					description: "Review the branch",
					scope: "repo",
				},
			],
		});
		expect(calls).toEqual([{ cwd: repository.rootCwd, forceReload: true }]);

		repositories.close();
	});

	test("lists coding repository workspace files from the repository root", async () => {
		const root = createTempDir("outclaw-browser-coding-workspace-files-");
		cleanupPaths.push(root);
		const repositories = new CodingRepositoryStore(join(root, "coding.sqlite"));
		const repositoryRoot = join(root, "repo");
		mkdirSync(join(root, "agents", "railly"), { recursive: true });
		mkdirSync(join(repositoryRoot, ".git"), { recursive: true });
		mkdirSync(join(repositoryRoot, "src"), { recursive: true });
		mkdirSync(join(repositoryRoot, "node_modules"), { recursive: true });
		writeFileSync(
			join(repositoryRoot, ".git", "HEAD"),
			"ref: refs/heads/main\n",
		);
		writeFileSync(join(repositoryRoot, ".DS_Store"), "");
		writeFileSync(join(root, "agents", "railly", "AGENTS.md"), "# Agent\n");
		writeFileSync(join(repositoryRoot, "README.md"), "# Repository\n");
		writeFileSync(join(repositoryRoot, "src", "index.ts"), "export {};\n");
		writeFileSync(
			join(repositoryRoot, "node_modules", "dependency.js"),
			"module.exports = {};\n",
		);
		const repository = repositories.register({
			rootCwd: repositoryRoot,
			displayName: "repo",
			source: "manual",
		});
		const api = createBrowserApi({
			agents: [],
			codingRepositories: repositories,
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map(),
		});

		await expect(
			api.listCodingRepositoryWorkspaceFiles(repository.id),
		).resolves.toEqual([
			{ kind: "file", path: "README.md" },
			{ kind: "directory", path: "src" },
			{ kind: "file", path: "src/index.ts" },
		]);

		repositories.close();
	});

	test("lists shallow coding repository tree entries with repository exclusions", async () => {
		const root = createTempDir("outclaw-browser-coding-tree-");
		cleanupPaths.push(root);
		const repositories = new CodingRepositoryStore(join(root, "coding.sqlite"));
		const repositoryRoot = join(root, "repo");
		mkdirSync(repositoryRoot, { recursive: true });
		runGit(repositoryRoot, ["init", "--initial-branch=main"]);
		runGit(repositoryRoot, ["config", "user.email", "test@example.com"]);
		runGit(repositoryRoot, ["config", "user.name", "Test User"]);
		writeFileSync(join(repositoryRoot, "README.md"), "# Repository\n");
		runGit(repositoryRoot, ["add", "README.md"]);
		runGit(repositoryRoot, ["commit", "-m", "Initial commit"]);
		mkdirSync(join(repositoryRoot, "src", "feature"), { recursive: true });
		mkdirSync(join(repositoryRoot, "node_modules", "dependency"), {
			recursive: true,
		});
		mkdirSync(join(repositoryRoot, "src", "node_modules", "dependency"), {
			recursive: true,
		});
		writeFileSync(join(repositoryRoot, "src", "index.ts"), "export {};\n");
		writeFileSync(join(repositoryRoot, "src", "feature", "view.ts"), "");
		writeFileSync(
			join(repositoryRoot, "node_modules", "dependency", "index.js"),
			"",
		);
		writeFileSync(
			join(repositoryRoot, "src", "node_modules", "dependency", "index.js"),
			"",
		);
		const repository = repositories.register({
			rootCwd: repositoryRoot,
			displayName: "repo",
			source: "manual",
		});
		const api = createBrowserApi({
			agents: [],
			codingRepositories: repositories,
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map(),
		});

		await expect(api.listCodingRepositoryTree(repository.id)).resolves.toEqual([
			{
				gitStatus: "new",
				kind: "directory",
				name: "src",
				path: "src",
			},
			{
				kind: "file",
				name: "README.md",
				path: "README.md",
			},
		]);
		await expect(
			api.listCodingRepositoryTree(repository.id, { path: "src" }),
		).resolves.toEqual([
			{
				gitStatus: "new",
				kind: "directory",
				name: "feature",
				path: "src/feature",
			},
			{
				gitStatus: "new",
				kind: "file",
				name: "index.ts",
				path: "src/index.ts",
			},
		]);
		const status = await api.readGitStatus({ repositoryId: repository.id });
		if (!status.initialized) {
			throw new Error("expected initialized git status");
		}
		expect(status.files).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ path: "src/feature/view.ts" }),
				expect.objectContaining({ path: "src/index.ts" }),
			]),
		);
		const statusPaths = status.files.map((file) => file.path);
		expect(statusPaths).not.toContain("node_modules/dependency/index.js");
		expect(statusPaths).not.toContain("src/node_modules/dependency/index.js");

		repositories.close();
	});

	test("lists coding repository tree from the focused coding session cwd", async () => {
		const root = createTempDir("outclaw-browser-coding-session-tree-");
		cleanupPaths.push(root);
		const dbPath = join(root, "coding.sqlite");
		const sessionStore = new SessionStore(dbPath, {
			agentId: CODING_STORAGE_OWNER_ID,
		});
		const repositories = new CodingRepositoryStore(dbPath);
		const codingSessions = new CodingSessionStore(dbPath);
		const repositoryRoot = join(root, "repo");
		const packageDir = join(repositoryRoot, "packages", "app");
		mkdirSync(packageDir, { recursive: true });
		writeFileSync(join(repositoryRoot, "README.md"), "# Repository\n");
		writeFileSync(join(packageDir, "index.ts"), "export {};\n");
		const repository = repositories.register({
			rootCwd: repositoryRoot,
			displayName: "repo",
			source: "manual",
		});
		sessionStore.upsert({
			providerId: "codex",
			sdkSessionId: "thread-app",
			title: "Package session",
			model: "gpt-5.5",
			source: "code",
			tag: "code",
		});
		codingSessions.upsert({
			providerId: "codex",
			sdkSessionId: "thread-app",
			repositoryId: repository.id,
			cwd: packageDir,
			runStatus: "idle",
		});
		const api = createBrowserApi({
			agents: [],
			codingRepositories: repositories,
			codingSessions,
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map(),
		});

		await expect(
			api.listCodingRepositoryTree(repository.id, {
				providerId: "codex",
				sdkSessionId: "thread-app",
			}),
		).resolves.toEqual([
			{
				kind: "file",
				name: "index.ts",
				path: "packages/app/index.ts",
			},
		]);

		codingSessions.close();
		sessionStore.close();
		repositories.close();
	});

	test("reads git status scoped to the focused coding session cwd", async () => {
		const root = createTempDir("outclaw-browser-coding-session-git-");
		cleanupPaths.push(root);
		const dbPath = join(root, "coding.sqlite");
		const sessionStore = new SessionStore(dbPath, {
			agentId: CODING_STORAGE_OWNER_ID,
		});
		const repositories = new CodingRepositoryStore(dbPath);
		const codingSessions = new CodingSessionStore(dbPath);
		const repositoryRoot = join(root, "repo");
		const packageDir = join(repositoryRoot, "packages", "app");
		mkdirSync(packageDir, { recursive: true });
		runGit(repositoryRoot, ["init", "--initial-branch=main"]);
		runGit(repositoryRoot, ["config", "user.email", "test@example.com"]);
		runGit(repositoryRoot, ["config", "user.name", "Test User"]);
		writeFileSync(join(repositoryRoot, "README.md"), "# Repository\n");
		runGit(repositoryRoot, ["add", "README.md"]);
		runGit(repositoryRoot, ["commit", "-m", "Initial commit"]);
		writeFileSync(join(repositoryRoot, "root-history.txt"), "root\n");
		runGit(repositoryRoot, ["add", "root-history.txt"]);
		runGit(repositoryRoot, ["commit", "-m", "Root history"]);
		writeFileSync(join(packageDir, "history.ts"), "export const value = 1;\n");
		runGit(repositoryRoot, ["add", "packages/app/history.ts"]);
		runGit(repositoryRoot, ["commit", "-m", "Package history"]);
		writeFileSync(join(repositoryRoot, "root-mixed.txt"), "root\n");
		writeFileSync(join(packageDir, "mixed.ts"), "export const mixed = 1;\n");
		runGit(repositoryRoot, ["add", "root-mixed.txt", "packages/app/mixed.ts"]);
		runGit(repositoryRoot, ["commit", "-m", "Mixed history"]);
		writeFileSync(join(repositoryRoot, "root-only.txt"), "root\n");
		writeFileSync(join(packageDir, "index.ts"), "export {};\n");
		const repository = repositories.register({
			rootCwd: repositoryRoot,
			displayName: "repo",
			source: "manual",
		});
		sessionStore.upsert({
			providerId: "codex",
			sdkSessionId: "thread-app",
			title: "Package session",
			model: "gpt-5.5",
			source: "code",
			tag: "code",
		});
		codingSessions.upsert({
			providerId: "codex",
			sdkSessionId: "thread-app",
			repositoryId: repository.id,
			cwd: packageDir,
			runStatus: "idle",
		});
		const api = createBrowserApi({
			agents: [],
			codingRepositories: repositories,
			codingSessions,
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map(),
		});

		const status = await api.readGitStatus({
			repositoryId: repository.id,
			providerId: "codex",
			sdkSessionId: "thread-app",
		});

		if (!status.initialized) {
			throw new Error("expected initialized git status");
		}
		expect(status.files.map((file) => file.path)).toEqual([
			"packages/app/index.ts",
		]);
		expect(
			status.history.commits.map((commit) => commit.commit.message),
		).toEqual(["Mixed history", "Package history"]);
		const mixedCommit = status.history.commits[0];
		if (!mixedCommit) {
			throw new Error("expected scoped history commit");
		}
		const mixedStats = await api.readGitCommitStats(mixedCommit.sha, {
			repositoryId: repository.id,
			providerId: "codex",
			sdkSessionId: "thread-app",
		});
		expect(mixedStats.files.map((file) => file.path)).toEqual([
			"packages/app/mixed.ts",
		]);

		codingSessions.close();
		sessionStore.close();
		repositories.close();
	});

	test("rejects coding repository skills when the coding service has no skill catalog", async () => {
		const root = createTempDir("outclaw-browser-coding-skills-missing-");
		cleanupPaths.push(root);
		const repositories = new CodingRepositoryStore(join(root, "coding.sqlite"));
		const repository = repositories.register({
			rootCwd: join(root, "repo"),
			displayName: "repo",
			source: "manual",
		});
		const api = createBrowserApi({
			agents: [],
			coding: {
				async startPrompt() {
					throw new Error("not called");
				},
				async resumePrompt() {
					throw new Error("not called");
				},
				stopPrompt: unusedStopPrompt,
			},
			codingRepositories: repositories,
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map(),
		});

		await expect(api.listCodingRepositorySkills(repository.id)).rejects.toThrow(
			"Coding skill catalog is not configured",
		);

		repositories.close();
	});

	test("opens a coding-session event stream that replays then follows", async () => {
		const root = createTempDir("outclaw-browser-coding-events-");
		cleanupPaths.push(root);
		const dbPath = join(root, "db.sqlite");

		const sessionStore = new SessionStore(dbPath, {
			agentId: CODING_STORAGE_OWNER_ID,
		});
		const codingSessions = new CodingSessionStore(dbPath);
		const events = new CodingSessionEventHub();

		sessionStore.upsert({
			providerId: "codex",
			sdkSessionId: "codex-1",
			title: "demo",
			model: "gpt-5.5",
			source: "code",
			tag: "code",
			timestamp: 10,
		});
		codingSessions.upsert({
			providerId: "codex",
			sdkSessionId: "codex-1",
			cwd: root,
			runStatus: "running",
			timestamp: 10,
		});
		const api = createBrowserApi({
			agents: [],
			coding: {
				startPrompt: async () => ({
					status: "rejected",
					message: "unused",
				}),
				resumePrompt: async () => ({
					status: "rejected",
					message: "unused",
				}),
				stopPrompt: unusedStopPrompt,
				rehydrateSessionEvents: async () => [
					{ type: "text", text: "a", sessionId: "codex-1" },
				],
			},
			codingEvents: events,
			codingSessions,
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map(),
		});

		const controller = new AbortController();
		const iterator = api
			.openCodingSessionEventStream({
				providerId: "codex",
				sdkSessionId: "codex-1",
				signal: controller.signal,
			})
			[Symbol.asyncIterator]();

		const first = await iterator.next();
		expect(first.value?.sequence).toBe(1);

		const live = iterator.next();
		events.append({
			providerId: "codex",
			sdkSessionId: "codex-1",
			event: { type: "text", text: "b", sessionId: "codex-1" },
		});
		const second = await live;
		expect(second.value?.sequence).toBe(2);
		expect(second.value?.event).toEqual({
			type: "text",
			text: "b",
			sessionId: "codex-1",
		});

		controller.abort();
		await iterator.next();

		events.close();
		codingSessions.close();
		sessionStore.close();
	});

	test("reads coding-session history from provider rehydration before following live events", async () => {
		const root = createTempDir("outclaw-browser-coding-event-seed-");
		cleanupPaths.push(root);
		const dbPath = join(root, "db.sqlite");

		const sessionStore = new SessionStore(dbPath, {
			agentId: CODING_STORAGE_OWNER_ID,
		});
		const codingSessions = new CodingSessionStore(dbPath);
		const events = new CodingSessionEventHub();

		sessionStore.upsert({
			providerId: "codex",
			sdkSessionId: "codex-1",
			title: "demo",
			model: "gpt-5.5",
			source: "code",
			tag: "code",
			timestamp: 10,
		});
		codingSessions.upsert({
			providerId: "codex",
			sdkSessionId: "codex-1",
			cwd: root,
			runStatus: "idle",
			timestamp: 10,
		});

		const rehydrateCalls: Array<{
			providerId: string;
			sdkSessionId: string;
		}> = [];
		const api = createBrowserApi({
			agents: [],
			coding: {
				startPrompt: async () => ({
					status: "rejected",
					message: "unused",
				}),
				resumePrompt: async () => ({
					status: "rejected",
					message: "unused",
				}),
				stopPrompt: unusedStopPrompt,
				rehydrateSessionEvents: async (params) => {
					rehydrateCalls.push(params);
					return [
						{
							type: "user_prompt",
							text: "inspect jsonl",
							sessionId: "codex-1",
						},
						{
							type: "thinking",
							text: "from jsonl",
							sessionId: "codex-1",
						},
						{
							type: "command_execution_completed",
							callId: "call-1",
							output: "tool result\n",
							sessionId: "codex-1",
						},
						{ type: "text", text: "final", sessionId: "codex-1" },
					];
				},
			},
			codingEvents: events,
			codingSessions,
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map(),
		});

		const controller = new AbortController();
		const iterator = api
			.openCodingSessionEventStream({
				providerId: "codex",
				sdkSessionId: "codex-1",
				signal: controller.signal,
			})
			[Symbol.asyncIterator]();

		const first = await iterator.next();
		const second = await iterator.next();
		const third = await iterator.next();
		const fourth = await iterator.next();
		expect(rehydrateCalls).toEqual([
			{ providerId: "codex", sdkSessionId: "codex-1" },
		]);
		expect(first.value?.sequence).toBe(1);
		expect(first.value?.event).toEqual({
			type: "user_prompt",
			text: "inspect jsonl",
			sessionId: "codex-1",
		});
		expect(second.value?.event).toEqual({
			type: "thinking",
			text: "from jsonl",
			sessionId: "codex-1",
		});
		expect(third.value?.event).toEqual({
			type: "command_execution_completed",
			callId: "call-1",
			output: "tool result\n",
			sessionId: "codex-1",
		});
		expect(fourth.value?.sequence).toBe(4);
		expect(fourth.value?.event).toEqual({
			type: "text",
			text: "final",
			sessionId: "codex-1",
		});

		const live = iterator.next();
		events.append({
			providerId: "codex",
			sdkSessionId: "codex-1",
			event: { type: "text", text: "live", sessionId: "codex-1" },
		});
		const fifth = await live;
		expect(fifth.value?.sequence).toBe(5);
		expect(fifth.value?.event).toEqual({
			type: "text",
			text: "live",
			sessionId: "codex-1",
		});

		controller.abort();
		await iterator.next();

		events.close();
		codingSessions.close();
		sessionStore.close();
	});

	test("opens replay-only coding-session event streams without following live events", async () => {
		const root = createTempDir("outclaw-browser-coding-event-replay-only-");
		cleanupPaths.push(root);
		const dbPath = join(root, "db.sqlite");

		const sessionStore = new SessionStore(dbPath, {
			agentId: CODING_STORAGE_OWNER_ID,
		});
		const codingSessions = new CodingSessionStore(dbPath);
		const events = new CodingSessionEventHub();

		sessionStore.upsert({
			providerId: "codex",
			sdkSessionId: "codex-1",
			title: "demo",
			model: "gpt-5.5",
			source: "code",
			tag: "code",
			timestamp: 10,
		});
		codingSessions.upsert({
			providerId: "codex",
			sdkSessionId: "codex-1",
			cwd: root,
			runStatus: "idle",
			timestamp: 10,
		});
		const api = createBrowserApi({
			agents: [],
			coding: {
				startPrompt: async () => ({
					status: "rejected",
					message: "unused",
				}),
				resumePrompt: async () => ({
					status: "rejected",
					message: "unused",
				}),
				stopPrompt: unusedStopPrompt,
				rehydrateSessionEvents: async () => [
					{ type: "text", text: "history", sessionId: "codex-1" },
				],
			},
			codingEvents: events,
			codingSessions,
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map(),
		});

		const iterator = api
			.openCodingSessionEventStream({
				providerId: "codex",
				sdkSessionId: "codex-1",
				follow: false,
			})
			[Symbol.asyncIterator]();

		expect((await iterator.next()).value?.event).toEqual({
			type: "text",
			text: "history",
			sessionId: "codex-1",
		});
		expect(await iterator.next()).toEqual({
			done: true,
			value: undefined,
		});

		events.close();
		codingSessions.close();
		sessionStore.close();
	});

	test("buffers live coding-session events while provider history is loading", async () => {
		const root = createTempDir("outclaw-browser-coding-event-buffer-");
		cleanupPaths.push(root);
		const dbPath = join(root, "db.sqlite");

		const sessionStore = new SessionStore(dbPath, {
			agentId: CODING_STORAGE_OWNER_ID,
		});
		const codingSessions = new CodingSessionStore(dbPath);
		const events = new CodingSessionEventHub();

		sessionStore.upsert({
			providerId: "codex",
			sdkSessionId: "codex-1",
			title: "demo",
			model: "gpt-5.5",
			source: "code",
			tag: "code",
			timestamp: 10,
		});
		codingSessions.upsert({
			providerId: "codex",
			sdkSessionId: "codex-1",
			cwd: root,
			runStatus: "idle",
			timestamp: 10,
		});
		const rehydrateCalls: Array<{
			providerId: string;
			sdkSessionId: string;
		}> = [];
		let resolveHistory: (events: CodingSessionEvent[]) => void = () => {};
		const history = new Promise<CodingSessionEvent[]>((resolve) => {
			resolveHistory = resolve;
		});
		const api = createBrowserApi({
			agents: [],
			coding: {
				startPrompt: async () => ({
					status: "rejected",
					message: "unused",
				}),
				resumePrompt: async () => ({
					status: "rejected",
					message: "unused",
				}),
				stopPrompt: unusedStopPrompt,
				rehydrateSessionEvents: async (params) => {
					rehydrateCalls.push(params);
					return history;
				},
			},
			codingEvents: events,
			codingSessions,
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map(),
		});

		const controller = new AbortController();
		const iterator = api
			.openCodingSessionEventStream({
				providerId: "codex",
				sdkSessionId: "codex-1",
				signal: controller.signal,
			})
			[Symbol.asyncIterator]();

		const firstFromStream = iterator.next();
		await Promise.resolve();
		events.append({
			providerId: "codex",
			sdkSessionId: "codex-1",
			event: { type: "text", text: "live", sessionId: "codex-1" },
			timestamp: 20,
		});
		resolveHistory([{ type: "text", text: "history", sessionId: "codex-1" }]);

		const first = await firstFromStream;
		expect(rehydrateCalls).toEqual([
			{ providerId: "codex", sdkSessionId: "codex-1" },
		]);
		expect(first.value?.sequence).toBe(1);
		expect(first.value?.event).toEqual({
			type: "text",
			text: "history",
			sessionId: "codex-1",
		});
		const second = await iterator.next();
		expect(second.value?.sequence).toBe(2);
		expect(second.value?.createdAt).toBe(20);
		expect(second.value?.event).toEqual({
			type: "text",
			text: "live",
			sessionId: "codex-1",
		});

		controller.abort();
		await iterator.next();

		events.close();
		codingSessions.close();
		sessionStore.close();
	});

	test("does not duplicate buffered live events already present in provider history", async () => {
		const root = createTempDir("outclaw-browser-coding-event-dedupe-");
		cleanupPaths.push(root);
		const dbPath = join(root, "db.sqlite");

		const sessionStore = new SessionStore(dbPath, {
			agentId: CODING_STORAGE_OWNER_ID,
		});
		const codingSessions = new CodingSessionStore(dbPath);
		const events = new CodingSessionEventHub();

		sessionStore.upsert({
			providerId: "codex",
			sdkSessionId: "codex-1",
			title: "demo",
			model: "gpt-5.5",
			source: "code",
			tag: "code",
			timestamp: 10,
		});
		codingSessions.upsert({
			providerId: "codex",
			sdkSessionId: "codex-1",
			cwd: root,
			runStatus: "running",
			timestamp: 10,
		});

		let resolveHistory: (events: CodingSessionEvent[]) => void = () => {};
		const history = new Promise<CodingSessionEvent[]>((resolve) => {
			resolveHistory = resolve;
		});
		const api = createBrowserApi({
			agents: [],
			coding: {
				startPrompt: async () => ({
					status: "rejected",
					message: "unused",
				}),
				resumePrompt: async () => ({
					status: "rejected",
					message: "unused",
				}),
				stopPrompt: unusedStopPrompt,
				rehydrateSessionEvents: async () => history,
			},
			codingEvents: events,
			codingSessions,
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map(),
		});

		const controller = new AbortController();
		const iterator = api
			.openCodingSessionEventStream({
				providerId: "codex",
				sdkSessionId: "codex-1",
				signal: controller.signal,
			})
			[Symbol.asyncIterator]();

		const firstFromStream = iterator.next();
		await Promise.resolve();
		events.append({
			providerId: "codex",
			sdkSessionId: "codex-1",
			event: { type: "text", text: "same", sessionId: "codex-1" },
			timestamp: 20,
		});
		resolveHistory([{ type: "text", text: "same", sessionId: "codex-1" }]);

		const first = await firstFromStream;
		expect(first.value?.event).toEqual({
			type: "text",
			text: "same",
			sessionId: "codex-1",
		});

		const secondFromStream = iterator.next();
		events.append({
			providerId: "codex",
			sdkSessionId: "codex-1",
			event: { type: "text", text: "after", sessionId: "codex-1" },
		});
		const second = await secondFromStream;
		expect(second.value?.sequence).toBe(2);
		expect(second.value?.event).toEqual({
			type: "text",
			text: "after",
			sessionId: "codex-1",
		});

		controller.abort();
		await iterator.next();

		events.close();
		codingSessions.close();
		sessionStore.close();
	});

	test("keeps a buffered live event when the same payload only appears earlier in provider history", async () => {
		const root = createTempDir("outclaw-browser-coding-event-dedupe-earlier-");
		cleanupPaths.push(root);
		const dbPath = join(root, "db.sqlite");

		const sessionStore = new SessionStore(dbPath, {
			agentId: CODING_STORAGE_OWNER_ID,
		});
		const codingSessions = new CodingSessionStore(dbPath);
		const events = new CodingSessionEventHub();

		sessionStore.upsert({
			providerId: "codex",
			sdkSessionId: "codex-1",
			title: "demo",
			model: "gpt-5.5",
			source: "code",
			tag: "code",
			timestamp: 10,
		});
		codingSessions.upsert({
			providerId: "codex",
			sdkSessionId: "codex-1",
			cwd: root,
			runStatus: "running",
			timestamp: 10,
		});

		let resolveHistory: (events: CodingSessionEvent[]) => void = () => {};
		const history = new Promise<CodingSessionEvent[]>((resolve) => {
			resolveHistory = resolve;
		});
		const repeatedEvent: CodingSessionEvent = {
			type: "user_prompt",
			text: "go on",
			sessionId: "codex-1",
		};
		const api = createBrowserApi({
			agents: [],
			coding: {
				startPrompt: async () => ({
					status: "rejected",
					message: "unused",
				}),
				resumePrompt: async () => ({
					status: "rejected",
					message: "unused",
				}),
				stopPrompt: unusedStopPrompt,
				rehydrateSessionEvents: async () => history,
			},
			codingEvents: events,
			codingSessions,
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map(),
		});

		const controller = new AbortController();
		const iterator = api
			.openCodingSessionEventStream({
				providerId: "codex",
				sdkSessionId: "codex-1",
				signal: controller.signal,
			})
			[Symbol.asyncIterator]();

		const firstFromStream = iterator.next();
		await Promise.resolve();
		events.append({
			providerId: "codex",
			sdkSessionId: "codex-1",
			event: repeatedEvent,
			timestamp: 20,
		});
		resolveHistory([
			repeatedEvent,
			{ type: "text", text: "history suffix", sessionId: "codex-1" },
		]);

		const first = await firstFromStream;
		const second = await iterator.next();
		expect(first.value?.event).toEqual(repeatedEvent);
		expect(second.value?.event).toEqual({
			type: "text",
			text: "history suffix",
			sessionId: "codex-1",
		});

		const thirdFromStream = iterator.next();
		events.append({
			providerId: "codex",
			sdkSessionId: "codex-1",
			event: { type: "text", text: "after", sessionId: "codex-1" },
			timestamp: 30,
		});
		const third = await thirdFromStream;
		expect(third.value?.sequence).toBe(3);
		expect(third.value?.createdAt).toBe(20);
		expect(third.value?.event).toEqual(repeatedEvent);

		const fourth = await iterator.next();
		expect(fourth.value?.sequence).toBe(4);
		expect(fourth.value?.createdAt).toBe(30);
		expect(fourth.value?.event).toEqual({
			type: "text",
			text: "after",
			sessionId: "codex-1",
		});

		controller.abort();
		await iterator.next();

		events.close();
		codingSessions.close();
		sessionStore.close();
	});

	test("honors sinceSequence across provider history and live coding-session events", async () => {
		const root = createTempDir("outclaw-browser-coding-event-cursor-");
		cleanupPaths.push(root);
		const dbPath = join(root, "db.sqlite");

		const sessionStore = new SessionStore(dbPath, {
			agentId: CODING_STORAGE_OWNER_ID,
		});
		const codingSessions = new CodingSessionStore(dbPath);
		const events = new CodingSessionEventHub();

		sessionStore.upsert({
			providerId: "codex",
			sdkSessionId: "codex-1",
			title: "demo",
			model: "gpt-5.5",
			source: "code",
			tag: "code",
			timestamp: 10,
		});
		codingSessions.upsert({
			providerId: "codex",
			sdkSessionId: "codex-1",
			cwd: root,
			runStatus: "idle",
			timestamp: 10,
		});
		const rehydrateCalls: Array<{
			providerId: string;
			sdkSessionId: string;
		}> = [];
		const api = createBrowserApi({
			agents: [],
			coding: {
				startPrompt: async () => ({
					status: "rejected",
					message: "unused",
				}),
				resumePrompt: async () => ({
					status: "rejected",
					message: "unused",
				}),
				stopPrompt: unusedStopPrompt,
				rehydrateSessionEvents: async (params) => {
					rehydrateCalls.push(params);
					return [
						{ type: "text", text: "one", sessionId: "codex-1" },
						{ type: "text", text: "two", sessionId: "codex-1" },
						{ type: "text", text: "three", sessionId: "codex-1" },
					];
				},
			},
			codingEvents: events,
			codingSessions,
			getRememberedAgentId: () => undefined,
			gitRoot: root,
			homeDir: root,
			storesByAgent: new Map(),
		});

		const controller = new AbortController();
		const iterator = api
			.openCodingSessionEventStream({
				providerId: "codex",
				sdkSessionId: "codex-1",
				sinceSequence: 2,
				signal: controller.signal,
			})
			[Symbol.asyncIterator]();

		const first = await iterator.next();
		expect(rehydrateCalls).toEqual([
			{ providerId: "codex", sdkSessionId: "codex-1" },
		]);
		expect(first.value?.sequence).toBe(3);
		expect(first.value?.event).toEqual({
			type: "text",
			text: "three",
			sessionId: "codex-1",
		});

		const secondFromStream = iterator.next();
		events.append({
			providerId: "codex",
			sdkSessionId: "codex-1",
			event: { type: "text", text: "live", sessionId: "codex-1" },
		});
		const second = await secondFromStream;
		expect(second.value?.sequence).toBe(4);
		expect(second.value?.event).toEqual({
			type: "text",
			text: "live",
			sessionId: "codex-1",
		});

		controller.abort();
		await iterator.next();

		events.close();
		codingSessions.close();
		sessionStore.close();
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
		mkdirSync(join(agentHomeDir, "node_modules"));
		writeFileSync(join(agentHomeDir, "node_modules", "dependency.js"), "");
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
				children: [
					{
						kind: "file",
						name: "dependency.js",
						path: "node_modules/dependency.js",
					},
				],
				kind: "directory",
				name: "node_modules",
				path: "node_modules",
			},
			{
				kind: "file",
				name: "AGENTS.md",
				path: "AGENTS.md",
			},
		]);

		await expect(api.listAgentWorkspaceFiles("agent-railly")).resolves.toEqual([
			{
				kind: "file",
				path: "AGENTS.md",
			},
			{
				kind: "directory",
				path: "cron",
			},
			{
				kind: "file",
				path: "cron/daily.yaml",
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
		).resolves.toMatchObject({
			content: "# Agent\n",
			kind: "text",
			language: "markdown",
			mtimeMs: expect.any(Number),
			path: "AGENTS.md",
			sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
			truncated: false,
		});

		await expect(
			api.readAgentFile("agent-railly", "cron/daily.yaml"),
		).resolves.toMatchObject({
			content:
				"name: Daily\nschedule: 15 6 * * *\nmodel: haiku\neffort: high\nenabled: true\nprompt: Check inbox\n",
			kind: "text",
			language: "yaml",
			mtimeMs: expect.any(Number),
			path: "cron/daily.yaml",
			sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
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

	test("includes git preview metadata when an agent file has working tree changes", async () => {
		const root = createTempDir("outclaw-browser-file-git-change-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		mkdirSync(agentHomeDir, { recursive: true });

		runGit(root, ["init", "--initial-branch=main"]);
		runGit(root, ["config", "user.email", "test@example.com"]);
		runGit(root, ["config", "user.name", "Test User"]);
		writeFileSync(join(agentHomeDir, "AGENTS.md"), "# Agent\n");
		runGit(root, ["add", "agents/railly/AGENTS.md"]);
		runGit(root, ["commit", "-m", "Initial commit"]);
		writeFileSync(join(agentHomeDir, "AGENTS.md"), "# Agent\n\nUpdated\n");

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
			api.readAgentFile("agent-railly", "AGENTS.md"),
		).resolves.toMatchObject({
			content: "# Agent\n\nUpdated\n",
			gitChange: {
				path: "agents/railly/AGENTS.md",
				status: "modified",
			},
			path: "AGENTS.md",
		});

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
					async (_providerId, sessionId) => [
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
			providerId: "codex",
			sdkSessionId: "cron-empty-index",
			title: "daily-report",
			model: "gpt-5.5",
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
					async (providerId, sessionId) => {
						expect(providerId).toBe("codex");
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
					providerId: "codex",
					sessionId: "cron-empty-index",
					ranAt: 1000,
					resultText: "Recovered cron output",
				},
			],
			hasMore: false,
		});
		expect(store.listCronRunsByTitle("daily-report", { limit: 1 })).toEqual([
			{
				providerId: "codex",
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

		await expect(api.readConfigFile()).resolves.toMatchObject({
			content: '{\n\t"host": "127.0.0.1",\n\t"port": 4000\n}\n',
			kind: "text",
			language: "json",
			mtimeMs: expect.any(Number),
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
			sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
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
		).resolves.toMatchObject({
			content: '{\n\t"host": "127.0.0.1",\n\t"port": 4100\n}\n',
			kind: "text",
			language: "json",
			mtimeMs: expect.any(Number),
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
			sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
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

	test("reads git status with structured commit history data", async () => {
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
			const secondCommit = status.history.commits.find(
				(commit) => commit.commit.message === "Second commit",
			);
			expect(secondCommit).toBeDefined();
			expect(secondCommit?.commit.author.name).toBe("Test User");
			expect(secondCommit?.parents.length).toBe(1);
			expect(secondCommit?.parents[0]?.sha.length).toBeGreaterThan(0);

			const initialCommit = status.history.commits.find(
				(commit) => commit.commit.message === "Initial commit",
			);
			expect(initialCommit).toBeDefined();
			expect(initialCommit?.parents).toEqual([]);
		} finally {
			store?.close();
			restoreProcessEnvValue("GIT_AUTHOR_NAME", previousGitAuthorName);
			restoreProcessEnvValue("GIT_AUTHOR_EMAIL", previousGitAuthorEmail);
			restoreProcessEnvValue("GIT_COMMITTER_NAME", previousGitCommitterName);
			restoreProcessEnvValue("GIT_COMMITTER_EMAIL", previousGitCommitterEmail);
		}
	});

	test("pages git commit history after the status history window", async () => {
		const root = createTempDir("outclaw-browser-git-history-pages-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		mkdirSync(agentHomeDir, { recursive: true });

		runGit(root, ["init", "--initial-branch=main"]);
		runGit(root, ["config", "user.email", "test@example.com"]);
		runGit(root, ["config", "user.name", "Test User"]);
		for (let index = 1; index <= 35; index += 1) {
			writeFileSync(join(root, "history.txt"), `${index}\n`);
			runGit(root, ["add", "history.txt"]);
			runGit(root, [
				"commit",
				"-m",
				`Commit ${String(index).padStart(2, "0")}`,
			]);
		}

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
		expect(status.history.commits).toHaveLength(30);
		expect(status.history.commits[0]?.commit.message).toBe("Commit 35");
		expect(status.history.commits[29]?.commit.message).toBe("Commit 06");
		expect(status.history.nextCursor).toBe("30");

		const olderHistory = await api.readGitHistory({
			cursor: status.history.nextCursor,
		});
		expect(olderHistory.commits.map((commit) => commit.commit.message)).toEqual(
			["Commit 05", "Commit 04", "Commit 03", "Commit 02", "Commit 01"],
		);
		expect(olderHistory.nextCursor).toBeUndefined();

		store.close();
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

	test("reads commit stats with per-file additions, deletions, and status", async () => {
		const root = createTempDir("outclaw-browser-git-commit-stats-");
		cleanupPaths.push(root);

		const dbPath = join(root, "db.sqlite");
		const agentHomeDir = join(root, "agents", "railly");
		mkdirSync(agentHomeDir, { recursive: true });

		runGit(root, ["init", "--initial-branch=main"]);
		runGit(root, ["config", "user.email", "test@example.com"]);
		runGit(root, ["config", "user.name", "Test User"]);
		writeFileSync(join(root, "keep.txt"), "alpha\nbeta\n");
		writeFileSync(join(root, "drop.txt"), "to-be-deleted\n");
		writeFileSync(join(root, "rename-source.txt"), "stable\n");
		runGit(root, ["add", "keep.txt", "drop.txt", "rename-source.txt"]);
		runGit(root, ["commit", "-m", "Initial commit"]);
		writeFileSync(join(root, "keep.txt"), "alpha\nbeta\ngamma\n");
		writeFileSync(join(root, "fresh.txt"), "new\nfile\n");
		runGit(root, ["rm", "drop.txt"]);
		runGit(root, ["mv", "rename-source.txt", "rename-target.txt"]);
		runGit(root, ["add", "keep.txt", "fresh.txt"]);
		runGit(root, ["commit", "-m", "Second commit"]);

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
		const stats = await api.readGitCommitStats(sha);
		expect(stats.sha).toBe(sha);
		expect(stats.totalAdditions).toBe(3);
		expect(stats.totalDeletions).toBe(1);
		expect(stats.files).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: "keep.txt",
					change: "modified",
					additions: 1,
					deletions: 0,
					binary: false,
				}),
				expect.objectContaining({
					path: "fresh.txt",
					change: "added",
					additions: 2,
					deletions: 0,
					binary: false,
				}),
				expect.objectContaining({
					path: "drop.txt",
					change: "deleted",
					additions: 0,
					deletions: 1,
					binary: false,
				}),
				expect.objectContaining({
					path: "rename-target.txt",
					change: "renamed",
					renamedFrom: "rename-source.txt",
					additions: 0,
					deletions: 0,
					binary: false,
				}),
			]),
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

	test("reads git status line counts across batched tracked file diffs", async () => {
		const root = createTempDir("outclaw-browser-git-batched-counts-");
		cleanupPaths.push(root);

		const agentHomeDir = join(root, "agents", "railly");
		mkdirSync(agentHomeDir, { recursive: true });

		runGit(root, ["init", "--initial-branch=main"]);
		runGit(root, ["config", "user.email", "test@example.com"]);
		runGit(root, ["config", "user.name", "Test User"]);
		for (let index = 0; index < 205; index += 1) {
			const fileName = `file-${String(index).padStart(3, "0")}.txt`;
			writeFileSync(join(root, fileName), "original\n");
		}
		runGit(root, ["add", "."]);
		runGit(root, ["commit", "-m", "Initial commit"]);
		for (let index = 0; index < 205; index += 1) {
			const fileName = `file-${String(index).padStart(3, "0")}.txt`;
			writeFileSync(join(root, fileName), "original\nupdated\n");
		}

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
		expect(status.files).toHaveLength(205);
		expect(status.files).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: "file-000.txt",
					additions: 1,
					deletions: 0,
				}),
				expect.objectContaining({
					path: "file-204.txt",
					additions: 1,
					deletions: 0,
				}),
			]),
		);
	});

	test("sums old and new path counts for renamed files with unstaged edits", async () => {
		const root = createTempDir("outclaw-browser-git-rename-counts-");
		cleanupPaths.push(root);

		const agentHomeDir = join(root, "agents", "railly");
		mkdirSync(agentHomeDir, { recursive: true });

		runGit(root, ["init", "--initial-branch=main"]);
		runGit(root, ["config", "user.email", "test@example.com"]);
		runGit(root, ["config", "user.name", "Test User"]);
		writeFileSync(join(root, "old.txt"), "one\ntwo\n");
		runGit(root, ["add", "."]);
		runGit(root, ["commit", "-m", "Initial commit"]);
		runGit(root, ["mv", "old.txt", "new.txt"]);
		writeFileSync(join(root, "new.txt"), "one\nthree\n");

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
					path: "new.txt",
					renamedFrom: "old.txt",
					additions: 2,
					deletions: 2,
				}),
			]),
		);
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
			'name: Once\nrunAt: "2999-01-23T09:00:00+00:00"\nmodel: haiku\nenabled: true\nprompt: Check inbox once\n',
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
			model: "haiku",
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
			'name: Expired\nrunAt: "2000-01-23T09:00:00+00:00"\nmodel: haiku\nenabled: true\nprompt: Check inbox once\n',
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
				model: "haiku",
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
			"name: Daily\nschedule: 15 6 * * *\nmodel: haiku\nenabled: true\nprompt: Check inbox\n",
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
				model: "haiku",
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
		const codexDir = join(agentHomeDir, ".codex");
		const ignoredGitPaths = [
			"agents/railly/.claude/skills",
			"agents/railly/.codex/skills",
		];
		mkdirSync(skillsDir, { recursive: true });
		mkdirSync(claudeDir, { recursive: true });
		mkdirSync(codexDir, { recursive: true });

		runGit(root, ["init", "--initial-branch=main"]);
		runGit(root, ["config", "user.email", "test@example.com"]);
		runGit(root, ["config", "user.name", "Test User"]);
		writeFileSync(join(root, "README.md"), "seed\n");
		runGit(root, ["add", "README.md"]);
		runGit(root, ["commit", "-m", "Initial commit"]);

		symlinkSync("../skills", join(claudeDir, "skills"));
		symlinkSync("../skills", join(codexDir, "skills"));
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
			ignoredGitPaths,
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
				...ignoredGitPaths.map((path) => expect.objectContaining({ path })),
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

	test("ignores inherited git hook environment when reading git status", async () => {
		const root = createTempDir("outclaw-browser-git-env-root-");
		const inheritedGitDirRoot = createTempDir(
			"outclaw-browser-git-env-source-",
		);
		cleanupPaths.push(root, inheritedGitDirRoot);

		const previousGitDir = process.env.GIT_DIR;
		const previousGitWorkTree = process.env.GIT_WORK_TREE;
		const agentHomeDir = join(root, "agents", "railly");
		mkdirSync(agentHomeDir, { recursive: true });

		runGit(inheritedGitDirRoot, ["init", "--initial-branch=main"]);
		writeFileSync(join(inheritedGitDirRoot, "README.md"), "source\n");
		runGit(inheritedGitDirRoot, ["add", "README.md"]);

		process.env.GIT_DIR = join(inheritedGitDirRoot, ".git");
		process.env.GIT_WORK_TREE = ".";

		try {
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

			await expect(api.readGitStatus()).resolves.toEqual({
				initialized: false,
				root,
			});
		} finally {
			restoreProcessEnvValue("GIT_DIR", previousGitDir);
			restoreProcessEnvValue("GIT_WORK_TREE", previousGitWorkTree);
		}
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
