import { describe, expect, test } from "bun:test";
import {
	SESSION_SEARCH_QUERY_MAX_LENGTH,
	sessionSearchQueryTooLongMessage,
} from "../../../src/runtime/application/session-search-query.ts";
import { FileConflictError } from "../../../src/runtime/browser/files/write-browser-file.ts";
import {
	type BrowserApi,
	handleBrowserApiRequest,
} from "../../../src/runtime/supervisor/browser-api-router.ts";

describe("handleBrowserApiRequest", () => {
	test("routes git history paging requests with repository scope", async () => {
		const calls: string[] = [];
		const browserApi = {
			readGitHistory: async (params?: {
				repositoryId?: string;
				cursor?: string;
				limit?: number;
			}) => {
				calls.push(
					`history:${params?.repositoryId ?? "default"}:${params?.cursor ?? "none"}:${params?.limit ?? "none"}`,
				);
				return {
					commits: [
						{
							sha: "abc123",
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
		} as unknown as BrowserApi;

		const url = new URL(
			"http://localhost/api/git/history?repositoryId=repo-1&cursor=30&limit=15",
		);
		const response = await handleBrowserApiRequest(
			new Request(url),
			url,
			browserApi,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			commits: [{ sha: "abc123" }],
			nextCursor: "45",
		});
		expect(calls).toEqual(["history:repo-1:30:15"]);
	});

	test("routes coding repository list, register, detail, and archive requests", async () => {
		const calls: string[] = [];
		const browserApi = {
			listCodingRepositories: async (params?: {
				includeArchived?: boolean;
			}) => {
				calls.push(`repo:list:${params?.includeArchived ?? false}`);
				return {
					repositories: [
						{
							id: "repo-1",
							rootCwd: "/workspace/outclaw",
							displayName: "outclaw",
							source: "manual",
							status: "active",
							createdAt: 10,
							lastActive: 20,
						},
					],
				};
			},
			registerCodingRepository: async (params: {
				rootCwd: string;
				displayName?: string;
				source?: string;
			}) => {
				calls.push(
					`repo:register:${params.rootCwd}:${params.displayName ?? "none"}:${params.source ?? "none"}`,
				);
				return {
					id: "repo-2",
					rootCwd: params.rootCwd,
					displayName: params.displayName ?? "repo",
					source: params.source ?? "manual",
					status: "active",
					createdAt: 30,
					lastActive: 30,
				};
			},
			getCodingRepository: async (repositoryId: string) => {
				calls.push(`repo:get:${repositoryId}`);
				return {
					id: repositoryId,
					rootCwd: "/workspace/outclaw",
					displayName: "outclaw",
					source: "manual",
					status: "active",
					createdAt: 10,
					lastActive: 20,
				};
			},
			archiveCodingRepository: async (repositoryId: string) => {
				calls.push(`repo:archive:${repositoryId}`);
				return {
					archived: true,
					repository: {
						id: repositoryId,
						rootCwd: "/workspace/outclaw",
						displayName: "outclaw",
						source: "manual",
						status: "archived",
						createdAt: 10,
						lastActive: 40,
					},
				};
			},
			restoreCodingRepository: async (repositoryId: string) => {
				calls.push(`repo:restore:${repositoryId}`);
				return {
					restored: true,
					repository: {
						id: repositoryId,
						rootCwd: "/workspace/outclaw",
						displayName: "outclaw",
						source: "manual",
						status: "active",
						createdAt: 10,
						lastActive: 50,
					},
				};
			},
			writeCodingRepositoryTerminalRunCommand: async (
				repositoryId: string,
				command: string,
			) => {
				calls.push(`repo:run-command:${repositoryId}:${command}`);
				return { command };
			},
		} as unknown as BrowserApi;

		const listUrl = new URL(
			"http://localhost/api/coding/repositories?includeArchived=true",
		);
		await expect(
			(
				await handleBrowserApiRequest(new Request(listUrl), listUrl, browserApi)
			).json(),
		).resolves.toMatchObject({
			repositories: [{ id: "repo-1" }],
		});

		const registerUrl = new URL("http://localhost/api/coding/repositories");
		await expect(
			(
				await handleBrowserApiRequest(
					new Request(registerUrl, {
						method: "POST",
						body: JSON.stringify({
							rootCwd: "/workspace/outclaw",
							displayName: "Outclaw",
							source: "manual",
						}),
					}),
					registerUrl,
					browserApi,
				)
			).json(),
		).resolves.toMatchObject({
			id: "repo-2",
		});

		const detailUrl = new URL(
			"http://localhost/api/coding/repositories/repo-1",
		);
		await expect(
			(
				await handleBrowserApiRequest(
					new Request(detailUrl),
					detailUrl,
					browserApi,
				)
			).json(),
		).resolves.toMatchObject({
			id: "repo-1",
		});

		const archiveUrl = new URL(
			"http://localhost/api/coding/repositories/repo-1/archive",
		);
		await expect(
			(
				await handleBrowserApiRequest(
					new Request(archiveUrl, { method: "POST" }),
					archiveUrl,
					browserApi,
				)
			).json(),
		).resolves.toMatchObject({
			archived: true,
			repository: { status: "archived" },
		});
		const restoreUrl = new URL(
			"http://localhost/api/coding/repositories/repo-1/restore",
		);
		await expect(
			(
				await handleBrowserApiRequest(
					new Request(restoreUrl, { method: "POST" }),
					restoreUrl,
					browserApi,
				)
			).json(),
		).resolves.toMatchObject({
			restored: true,
			repository: { status: "active" },
		});
		const runCommandUrl = new URL(
			"http://localhost/api/coding/repositories/repo-1/terminal-run-command",
		);
		await expect(
			(
				await handleBrowserApiRequest(
					new Request(runCommandUrl, {
						method: "PATCH",
						body: JSON.stringify({ command: "bun run check" }),
					}),
					runCommandUrl,
					browserApi,
				)
			).json(),
		).resolves.toEqual({
			command: "bun run check",
		});

		expect(calls).toEqual([
			"repo:list:true",
			"repo:register:/workspace/outclaw:Outclaw:manual",
			"repo:get:repo-1",
			"repo:archive:repo-1",
			"repo:restore:repo-1",
			"repo:run-command:repo-1:bun run check",
		]);
	});

	test("routes coding repository clone requests through cloneCodingRepository", async () => {
		const cloneCalls: Array<{
			remoteUrl: string;
			parentDir: string;
			displayName?: string;
		}> = [];
		const browserApi = {
			cloneCodingRepository: async (params: {
				remoteUrl: string;
				parentDir: string;
				displayName?: string;
			}) => {
				cloneCalls.push(params);
				return {
					status: "cloned",
					repository: {
						id: "repo-3",
						rootCwd: `${params.parentDir}/outclaw`,
						displayName: params.displayName ?? "outclaw",
						remoteUrl: params.remoteUrl,
						source: "clone",
						status: "active",
						createdAt: 50,
						lastActive: 50,
					},
				} as const;
			},
		} as unknown as BrowserApi;

		const url = new URL("http://localhost/api/coding/repositories/clone");
		const response = await handleBrowserApiRequest(
			new Request(url, {
				method: "POST",
				body: JSON.stringify({
					remoteUrl: "https://example.com/foo/outclaw.git",
					parentDir: "/Users/dev/projects",
				}),
			}),
			url,
			browserApi,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			status: "cloned",
			repository: { id: "repo-3", source: "clone" },
		});
		expect(cloneCalls).toEqual([
			{
				remoteUrl: "https://example.com/foo/outclaw.git",
				parentDir: "/Users/dev/projects",
			},
		]);
	});

	test("rejects clone requests missing remote URL or parent directory", async () => {
		const browserApi = {
			cloneCodingRepository: async () => {
				throw new Error("should not be called");
			},
		} as unknown as BrowserApi;

		const url = new URL("http://localhost/api/coding/repositories/clone");
		const response = await handleBrowserApiRequest(
			new Request(url, {
				method: "POST",
				body: JSON.stringify({ remoteUrl: "https://example.com/foo.git" }),
			}),
			url,
			browserApi,
		);

		expect(response.status).toBe(400);
	});

	test("rejects non-POST methods on the clone route", async () => {
		const browserApi = {
			cloneCodingRepository: async () => {
				throw new Error("should not be called");
			},
		} as unknown as BrowserApi;

		const url = new URL("http://localhost/api/coding/repositories/clone");
		const response = await handleBrowserApiRequest(
			new Request(url),
			url,
			browserApi,
		);
		expect(response.status).toBe(405);
	});

	test("routes the coding folder picker POST to the browser API", async () => {
		let invocations = 0;
		const browserApi = {
			pickCodingRepositoryFolder: async () => {
				invocations += 1;
				return { status: "selected", path: "/Users/dev/foo" } as const;
			},
		} as unknown as BrowserApi;

		const url = new URL("http://localhost/api/coding/folder-picker");
		const response = await handleBrowserApiRequest(
			new Request(url, { method: "POST" }),
			url,
			browserApi,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			status: "selected",
			path: "/Users/dev/foo",
		});
		expect(invocations).toBe(1);
	});

	test("rejects non-POST methods on the folder picker route", async () => {
		const browserApi = {
			pickCodingRepositoryFolder: async () => {
				throw new Error("should not be called");
			},
		} as unknown as BrowserApi;

		const url = new URL("http://localhost/api/coding/folder-picker");
		const response = await handleBrowserApiRequest(
			new Request(url),
			url,
			browserApi,
		);
		expect(response.status).toBe(405);
	});

	test("routes coding session list requests with cursor and linked chat filters", async () => {
		let params:
			| {
					limit: number;
					cursor?: { lastActive: number; sdkSessionId: string };
					linkedChatSessionId?: string;
					lifecycleStatus?: "open" | "archived";
					providerId?: string;
					repositoryId?: string;
			  }
			| undefined;
		const browserApi = {
			listCodingSessions: async (
				nextParams: Exclude<typeof params, undefined>,
			) => {
				params = nextParams;
				return {
					sessions: [
						{
							providerId: "codex",
							sdkSessionId: "code-1",
							title: "Code task",
							model: "gpt-5.5",
							lastActive: 20,
							cwd: "/workspace/outclaw",
							lifecycleStatus: "open",
							runStatus: "running",
							createdAt: 10,
							source: "code",
							tag: "code",
						},
					],
				};
			},
		} as unknown as BrowserApi;
		const url = new URL(
			"http://localhost/api/coding/sessions?limit=5&cursorLastActive=20&cursorSdkSessionId=code-1&providerId=codex&repositoryId=repo-1&linkedChatSessionId=chat-1&lifecycleStatus=archived",
		);

		const response = await handleBrowserApiRequest(
			new Request(url),
			url,
			browserApi,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			sessions: [
				{
					providerId: "codex",
					sdkSessionId: "code-1",
					title: "Code task",
					model: "gpt-5.5",
					lastActive: 20,
					cwd: "/workspace/outclaw",
					lifecycleStatus: "open",
					runStatus: "running",
					createdAt: 10,
					source: "code",
					tag: "code",
				},
			],
		});
		expect(params).toEqual({
			limit: 5,
			cursor: {
				lastActive: 20,
				sdkSessionId: "code-1",
			},
			linkedChatSessionId: "chat-1",
			lifecycleStatus: "archived",
			providerId: "codex",
			repositoryId: "repo-1",
		});
	});

	test("routes agent active-session requests", async () => {
		const calls: string[] = [];
		const browserApi = {
			getAgentActiveSession: (agentId: string) => {
				calls.push(agentId);
				return {
					activeSession: {
						providerId: "claude",
						sdkSessionId: "chat-1",
					},
				};
			},
		} as unknown as BrowserApi;
		const url = new URL(
			"http://localhost/api/agents/agent-railly/active-session",
		);

		const response = await handleBrowserApiRequest(
			new Request(url),
			url,
			browserApi,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			activeSession: {
				providerId: "claude",
				sdkSessionId: "chat-1",
			},
		});
		expect(calls).toEqual(["agent-railly"]);
	});

	test("routes agent chat-model catalog requests", async () => {
		const calls: string[] = [];
		const browserApi = {
			listAgentChatModels: async (agentId: string) => {
				calls.push(agentId);
				return {
					models: [
						{
							providerId: "codex",
							providerDisplayName: "Codex",
							model: "gpt-5.5",
							displayName: "GPT-5.5",
							description: "Codex model",
							isDefault: true,
							defaultReasoningEffort: "medium",
							supportedReasoningEfforts: ["low", "medium"],
							serviceTiers: [],
						},
					],
				};
			},
		} as unknown as BrowserApi;
		const url = new URL("http://localhost/api/agents/agent-railly/chat-models");

		const response = await handleBrowserApiRequest(
			new Request(url),
			url,
			browserApi,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			models: [
				expect.objectContaining({
					providerId: "codex",
					model: "gpt-5.5",
				}),
			],
		});
		expect(calls).toEqual(["agent-railly"]);
	});

	test("routes chat coding link requests by chat session identity", async () => {
		let params:
			| {
					agentId: string;
					providerId: string;
					sdkSessionId: string;
			  }
			| undefined;
		const browserApi = {
			listChatCodingSessions: async (input: typeof params) => {
				params = input;
				return {
					sessions: [
						{
							providerId: "codex",
							sdkSessionId: "code-1",
							title: "Coding task",
							model: "gpt-5.5",
							lastActive: 20,
							cwd: "/workspace/outclaw",
							lifecycleStatus: "open",
							runStatus: "idle",
							createdAt: 10,
							source: "code",
							tag: "code",
						},
					],
				};
			},
		} as unknown as BrowserApi;
		const url = new URL(
			"http://localhost/api/agents/agent-railly/sessions/claude/chat-1/coding-links",
		);

		const response = await handleBrowserApiRequest(
			new Request(url),
			url,
			browserApi,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			sessions: [{ providerId: "codex", sdkSessionId: "code-1" }],
		});
		expect(params).toEqual({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: "chat-1",
		});
	});

	test("routes coding session detail requests by provider session identity", async () => {
		let params:
			| {
					providerId: string;
					sdkSessionId: string;
			  }
			| undefined;
		const browserApi = {
			getCodingSession: async (providerId: string, sdkSessionId: string) => {
				params = { providerId, sdkSessionId };
				return {
					providerId,
					sdkSessionId,
					title: "Code detail",
					model: "gpt-5.5",
					lastActive: 20,
					cwd: "/workspace/outclaw",
					lifecycleStatus: "open",
					runStatus: "idle",
					createdAt: 10,
					source: "code",
					tag: "code",
				};
			},
		} as unknown as BrowserApi;
		const url = new URL("http://localhost/api/coding/sessions/codex/code-1");

		const response = await handleBrowserApiRequest(
			new Request(url),
			url,
			browserApi,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			providerId: "codex",
			sdkSessionId: "code-1",
			title: "Code detail",
			model: "gpt-5.5",
			lastActive: 20,
			cwd: "/workspace/outclaw",
			lifecycleStatus: "open",
			runStatus: "idle",
			createdAt: 10,
			source: "code",
			tag: "code",
		});
		expect(params).toEqual({
			providerId: "codex",
			sdkSessionId: "code-1",
		});
	});

	test("routes coding session delete requests by provider session identity", async () => {
		let params:
			| {
					providerId: string;
					sdkSessionId: string;
			  }
			| undefined;
		const browserApi = {
			deleteCodingSession: async (providerId: string, sdkSessionId: string) => {
				params = { providerId, sdkSessionId };
				return {
					deleted: true,
					providerId,
					sdkSessionId,
				};
			},
		} as unknown as BrowserApi;
		const url = new URL("http://localhost/api/coding/sessions/codex/code-1");

		const response = await handleBrowserApiRequest(
			new Request(url, { method: "DELETE" }),
			url,
			browserApi,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			deleted: true,
			providerId: "codex",
			sdkSessionId: "code-1",
		});
		expect(params).toEqual({
			providerId: "codex",
			sdkSessionId: "code-1",
		});
	});

	test("routes coding session archive and restore requests by provider session identity", async () => {
		const calls: string[] = [];
		const browserApi = {
			archiveCodingSession: async (
				providerId: string,
				sdkSessionId: string,
			) => {
				calls.push(`archive:${providerId}:${sdkSessionId}`);
				return {
					archived: true,
					session: {
						providerId,
						sdkSessionId,
						title: "Archived code",
						model: "gpt-5.5",
						lastActive: 30,
						cwd: "/workspace/outclaw",
						lifecycleStatus: "archived",
						runStatus: "idle",
						createdAt: 10,
						source: "code",
						tag: "code",
					},
				};
			},
			restoreCodingSession: async (
				providerId: string,
				sdkSessionId: string,
			) => {
				calls.push(`restore:${providerId}:${sdkSessionId}`);
				return {
					restored: true,
					session: {
						providerId,
						sdkSessionId,
						title: "Restored code",
						model: "gpt-5.5",
						lastActive: 40,
						cwd: "/workspace/outclaw",
						lifecycleStatus: "open",
						runStatus: "idle",
						createdAt: 10,
						source: "code",
						tag: "code",
					},
				};
			},
		} as unknown as BrowserApi;

		const archiveUrl = new URL(
			"http://localhost/api/coding/sessions/codex/code-1/archive",
		);
		await expect(
			(
				await handleBrowserApiRequest(
					new Request(archiveUrl, { method: "POST" }),
					archiveUrl,
					browserApi,
				)
			).json(),
		).resolves.toMatchObject({
			archived: true,
			session: {
				providerId: "codex",
				sdkSessionId: "code-1",
				lifecycleStatus: "archived",
			},
		});

		const restoreUrl = new URL(
			"http://localhost/api/coding/sessions/codex/code-1/restore",
		);
		await expect(
			(
				await handleBrowserApiRequest(
					new Request(restoreUrl, { method: "POST" }),
					restoreUrl,
					browserApi,
				)
			).json(),
		).resolves.toMatchObject({
			restored: true,
			session: {
				providerId: "codex",
				sdkSessionId: "code-1",
				lifecycleStatus: "open",
			},
		});
		expect(calls).toEqual(["archive:codex:code-1", "restore:codex:code-1"]);
	});

	test("routes GET /api/coding/models to listCodingModels", async () => {
		const browserApi = {
			listCodingModels: async () => ({
				models: [
					{
						id: "gpt-5.5",
						model: "gpt-5.5",
						displayName: "GPT-5.5",
						description: "frontier",
						isDefault: true,
						defaultReasoningEffort: "medium",
						supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
					},
				],
			}),
		} as unknown as BrowserApi;
		const url = new URL("http://localhost/api/coding/models");

		const response = await handleBrowserApiRequest(
			new Request(url),
			url,
			browserApi,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			models: [
				{
					id: "gpt-5.5",
					model: "gpt-5.5",
					displayName: "GPT-5.5",
					description: "frontier",
					isDefault: true,
					defaultReasoningEffort: "medium",
					supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
				},
			],
		});
	});

	test("forwards model and effort on coding start and resume routes", async () => {
		let startInput: Record<string, unknown> | undefined;
		let resumeInput: Record<string, unknown> | undefined;
		const browserApi = {
			startCodingSession: async (input: Record<string, unknown>) => {
				startInput = input;
				return {
					status: "accepted" as const,
					providerId: "codex",
					sdkSessionId: "codex-1",
				};
			},
			resumeCodingSession: async (input: Record<string, unknown>) => {
				resumeInput = input;
				return {
					status: "accepted" as const,
					providerId: "codex",
					sdkSessionId: "codex-1",
				};
			},
		} as unknown as BrowserApi;

		const startUrl = new URL("http://localhost/api/coding/sessions");
		await handleBrowserApiRequest(
			new Request(startUrl, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					repositoryId: "repo-1",
					prompt: "fix",
					model: "gpt-5.5",
					effort: "high",
				}),
			}),
			startUrl,
			browserApi,
		);
		const resumeUrl = new URL(
			"http://localhost/api/coding/sessions/codex/codex-1/resume",
		);
		await handleBrowserApiRequest(
			new Request(resumeUrl, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					prompt: "continue",
					model: "gpt-5.4-mini",
					effort: "low",
				}),
			}),
			resumeUrl,
			browserApi,
		);

		expect(startInput).toMatchObject({ model: "gpt-5.5", effort: "high" });
		expect(resumeInput).toMatchObject({ model: "gpt-5.4-mini", effort: "low" });
	});

	test("routes coding session start requests as POST /api/coding/sessions", async () => {
		let params:
			| {
					repositoryId?: string;
					cwd?: string;
					prompt: string;
			  }
			| undefined;
		const browserApi = {
			startCodingSession: async (input: typeof params) => {
				params = input;
				return {
					status: "accepted" as const,
					providerId: "codex",
					sdkSessionId: "codex-thread-1",
				};
			},
		} as unknown as BrowserApi;
		const url = new URL("http://localhost/api/coding/sessions");

		const response = await handleBrowserApiRequest(
			new Request(url, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					repositoryId: "repo-1",
					prompt: "fix the tests",
				}),
			}),
			url,
			browserApi,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			status: "accepted",
			providerId: "codex",
			sdkSessionId: "codex-thread-1",
		});
		expect(params).toEqual({
			repositoryId: "repo-1",
			prompt: "fix the tests",
		});
	});

	test("links coding start, resume, and status requests when chat context headers are present", async () => {
		const links: string[] = [];
		const notifications: string[] = [];
		const browserApi = {
			startCodingSession: async () => ({
				status: "accepted" as const,
				providerId: "codex",
				sdkSessionId: "code-start",
			}),
			resumeCodingSession: async () => ({
				status: "accepted" as const,
				providerId: "codex",
				sdkSessionId: "code-resume",
			}),
			getCodingSessionStatus: async (
				providerId: string,
				sdkSessionId: string,
			) => ({
				providerId,
				sdkSessionId,
				state: "done" as const,
				finalResponse: "finished",
			}),
			linkChatCodingSession: (params: {
				chatAgentId: string;
				chatProviderId: string;
				chatSdkSessionId: string;
				codingProviderId: string;
				codingSdkSessionId: string;
			}) => {
				links.push(
					`${params.chatAgentId}:${params.chatProviderId}/${params.chatSdkSessionId}->${params.codingProviderId}/${params.codingSdkSessionId}`,
				);
			},
		} as unknown as BrowserApi;
		const headers = {
			"content-type": "application/json",
			"x-outclaw-chat-agent-id": "agent-railly",
			"x-outclaw-chat-provider-id": "claude",
			"x-outclaw-chat-session-id": "chat-1",
		};

		const startUrl = new URL("http://localhost/api/coding/sessions");
		await handleBrowserApiRequest(
			new Request(startUrl, {
				method: "POST",
				headers,
				body: JSON.stringify({
					repositoryId: "repo-1",
					prompt: "fix",
				}),
			}),
			startUrl,
			browserApi,
			{
				onChatCodingLinksChanged: (event) => {
					notifications.push(
						`${event.chatAgentId}:${event.chatProviderId}/${event.chatSdkSessionId}->${event.codingProviderId}/${event.codingSdkSessionId}`,
					);
				},
			},
		);
		const resumeUrl = new URL(
			"http://localhost/api/coding/sessions/codex/code-resume/resume",
		);
		await handleBrowserApiRequest(
			new Request(resumeUrl, {
				method: "POST",
				headers,
				body: JSON.stringify({ prompt: "continue" }),
			}),
			resumeUrl,
			browserApi,
			{
				onChatCodingLinksChanged: (event) => {
					notifications.push(
						`${event.chatAgentId}:${event.chatProviderId}/${event.chatSdkSessionId}->${event.codingProviderId}/${event.codingSdkSessionId}`,
					);
				},
			},
		);
		const statusUrl = new URL(
			"http://localhost/api/coding/sessions/codex/code-status/status",
		);
		await handleBrowserApiRequest(
			new Request(statusUrl, { headers }),
			statusUrl,
			browserApi,
			{
				onChatCodingLinksChanged: (event) => {
					notifications.push(
						`${event.chatAgentId}:${event.chatProviderId}/${event.chatSdkSessionId}->${event.codingProviderId}/${event.codingSdkSessionId}`,
					);
				},
			},
		);

		expect(links).toEqual([
			"agent-railly:claude/chat-1->codex/code-start",
			"agent-railly:claude/chat-1->codex/code-resume",
			"agent-railly:claude/chat-1->codex/code-status",
		]);
		expect(notifications).toEqual(links);
	});

	test("does not link rejected coding start requests", async () => {
		let linked = false;
		const browserApi = {
			startCodingSession: async () => ({
				status: "rejected" as const,
				message: "Coding service is not configured",
			}),
			linkChatCodingSession: () => {
				linked = true;
			},
		} as unknown as BrowserApi;
		const url = new URL("http://localhost/api/coding/sessions");

		const response = await handleBrowserApiRequest(
			new Request(url, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-outclaw-chat-agent-id": "agent-railly",
					"x-outclaw-chat-provider-id": "claude",
					"x-outclaw-chat-session-id": "chat-1",
				},
				body: JSON.stringify({
					repositoryId: "repo-1",
					prompt: "fix",
				}),
			}),
			url,
			browserApi,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			status: "rejected",
			message: "Coding service is not configured",
		});
		expect(linked).toBe(false);
	});

	test("rejects coding session start requests without a prompt", async () => {
		let called = false;
		const browserApi = {
			startCodingSession: async () => {
				called = true;
				return {
					status: "accepted" as const,
					providerId: "codex",
					sdkSessionId: "x",
				};
			},
		} as unknown as BrowserApi;
		const url = new URL("http://localhost/api/coding/sessions");

		const response = await handleBrowserApiRequest(
			new Request(url, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ repositoryId: "repo-1", prompt: "  " }),
			}),
			url,
			browserApi,
		);

		expect(response.status).toBe(400);
		expect(called).toBe(false);
	});

	test("routes coding session resume requests as POST /api/coding/sessions/:provider/:id/resume", async () => {
		let params:
			| {
					providerId: string;
					sdkSessionId: string;
					prompt: string;
			  }
			| undefined;
		const browserApi = {
			resumeCodingSession: async (input: typeof params) => {
				params = input;
				return {
					status: "accepted" as const,
					providerId: input?.providerId ?? "",
					sdkSessionId: input?.sdkSessionId ?? "",
				};
			},
		} as unknown as BrowserApi;
		const url = new URL(
			"http://localhost/api/coding/sessions/codex/codex-thread-1/resume",
		);

		const response = await handleBrowserApiRequest(
			new Request(url, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ prompt: "follow up" }),
			}),
			url,
			browserApi,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			status: "accepted",
			providerId: "codex",
			sdkSessionId: "codex-thread-1",
		});
		expect(params).toEqual({
			providerId: "codex",
			sdkSessionId: "codex-thread-1",
			prompt: "follow up",
		});
	});

	test("routes coding session stop requests as POST /api/coding/sessions/:provider/:id/stop", async () => {
		let params:
			| {
					providerId: string;
					sdkSessionId: string;
			  }
			| undefined;
		const browserApi = {
			stopCodingSession: async (input: typeof params) => {
				params = input;
				return {
					status: "accepted" as const,
					providerId: input?.providerId ?? "",
					sdkSessionId: input?.sdkSessionId ?? "",
				};
			},
		} as unknown as BrowserApi;
		const url = new URL(
			"http://localhost/api/coding/sessions/codex/codex-thread-1/stop",
		);

		const response = await handleBrowserApiRequest(
			new Request(url, {
				method: "POST",
			}),
			url,
			browserApi,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			status: "accepted",
			providerId: "codex",
			sdkSessionId: "codex-thread-1",
		});
		expect(params).toEqual({
			providerId: "codex",
			sdkSessionId: "codex-thread-1",
		});
	});

	test("routes coding session cancel requests as POST /api/coding/sessions/:provider/:id/cancel", async () => {
		let params:
			| {
					providerId: string;
					sdkSessionId: string;
			  }
			| undefined;
		const browserApi = {
			cancelCodingSession: async (input: typeof params) => {
				params = input;
				return {
					status: "accepted" as const,
					providerId: input?.providerId ?? "",
					sdkSessionId: input?.sdkSessionId ?? "",
				};
			},
		} as unknown as BrowserApi;
		const url = new URL(
			"http://localhost/api/coding/sessions/codex/codex-thread-1/cancel",
		);

		const response = await handleBrowserApiRequest(
			new Request(url, {
				method: "POST",
			}),
			url,
			browserApi,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			status: "accepted",
			providerId: "codex",
			sdkSessionId: "codex-thread-1",
		});
		expect(params).toEqual({
			providerId: "codex",
			sdkSessionId: "codex-thread-1",
		});
	});

	test("routes coding session status requests as GET /api/coding/sessions/:provider/:id/status", async () => {
		let params:
			| {
					providerId: string;
					sdkSessionId: string;
			  }
			| undefined;
		const browserApi = {
			getCodingSessionStatus: async (
				providerId: string,
				sdkSessionId: string,
			) => {
				params = { providerId, sdkSessionId };
				return {
					providerId,
					sdkSessionId,
					state: "done" as const,
					finalResponse: "final answer",
				};
			},
		} as unknown as BrowserApi;
		const url = new URL(
			"http://localhost/api/coding/sessions/codex/codex-thread-1/status",
		);

		const response = await handleBrowserApiRequest(
			new Request(url),
			url,
			browserApi,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			providerId: "codex",
			sdkSessionId: "codex-thread-1",
			state: "done",
			finalResponse: "final answer",
		});
		expect(params).toEqual({
			providerId: "codex",
			sdkSessionId: "codex-thread-1",
		});
	});

	test("reports unknown coding sessions as not found", async () => {
		const browserApi = {
			getCodingSession: async () => {
				throw new Error("Unknown coding session: codex/missing");
			},
		} as unknown as BrowserApi;
		const url = new URL("http://localhost/api/coding/sessions/codex/missing");

		const response = await handleBrowserApiRequest(
			new Request(url),
			url,
			browserApi,
		);

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toEqual({
			error: "Unknown coding session: codex/missing",
		});
	});

	test("rejects oversized session search queries before calling the browser API", async () => {
		let listCalls = 0;
		const browserApi = {
			listAgentSessions: async () => {
				listCalls += 1;
				return { sessions: [] };
			},
		} as unknown as BrowserApi;
		const url = new URL(
			`http://localhost/api/agents/agent-railly/sessions?query=${"a".repeat(
				SESSION_SEARCH_QUERY_MAX_LENGTH + 1,
			)}`,
		);

		const response = await handleBrowserApiRequest(
			new Request(url),
			url,
			browserApi,
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			error: sessionSearchQueryTooLongMessage(),
		});
		expect(listCalls).toBe(0);
	});

	test("routes conflict-safe file writes to the browser API", async () => {
		let call:
			| {
					agentId: string;
					path: string;
					content: string;
					expected: { mtimeMs: number; sha256: string };
			  }
			| undefined;
		const browserApi = {
			writeAgentFile: async (
				agentId: string,
				path: string,
				content: string,
				expected: { mtimeMs: number; sha256: string },
			) => {
				call = { agentId, path, content, expected };
				return {
					content: "next",
					kind: "text",
					mtimeMs: 456,
					path,
					sha256: "b".repeat(64),
					truncated: false,
				};
			},
		} as unknown as BrowserApi;
		const url = new URL(
			"http://localhost/api/agents/agent-railly/file?path=AGENTS.md",
		);

		const response = await handleBrowserApiRequest(
			new Request(url, {
				body: JSON.stringify({
					content: "next",
					expectedMtimeMs: 123,
					expectedSha256: "a".repeat(64),
				}),
				method: "PUT",
			}),
			url,
			browserApi,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			content: "next",
			mtimeMs: 456,
			sha256: "b".repeat(64),
		});
		expect(call).toEqual({
			agentId: "agent-railly",
			content: "next",
			expected: { mtimeMs: 123, sha256: "a".repeat(64) },
			path: "AGENTS.md",
		});
	});

	test("rejects file write bodies larger than one megabyte", async () => {
		let writeCalls = 0;
		const browserApi = {
			writeAgentFile: async () => {
				writeCalls += 1;
				throw new Error("should not be called");
			},
		} as unknown as BrowserApi;
		const url = new URL(
			"http://localhost/api/agents/agent-railly/file?path=AGENTS.md",
		);

		const response = await handleBrowserApiRequest(
			new Request(url, {
				body: "{}",
				headers: { "content-length": `${1024 * 1024 + 1}` },
				method: "PUT",
			}),
			url,
			browserApi,
		);

		expect(response.status).toBe(413);
		await expect(response.json()).resolves.toEqual({
			error: "File write body too large",
		});
		expect(writeCalls).toBe(0);
	});

	test("returns a conflict response for stale file writes", async () => {
		const current = {
			content: "disk",
			kind: "text" as const,
			mtimeMs: 456,
			path: "AGENTS.md",
			sha256: "b".repeat(64),
			truncated: false,
		};
		const browserApi = {
			writeAgentFile: async () => {
				throw new FileConflictError(current);
			},
		} as unknown as BrowserApi;
		const url = new URL(
			"http://localhost/api/agents/agent-railly/file?path=AGENTS.md",
		);

		const response = await handleBrowserApiRequest(
			new Request(url, {
				body: JSON.stringify({
					content: "mine",
					expectedMtimeMs: 123,
					expectedSha256: "a".repeat(64),
				}),
				method: "PUT",
			}),
			url,
			browserApi,
		);

		expect(response.status).toBe(409);
		await expect(response.json()).resolves.toEqual({
			current,
			kind: "conflict",
		});
	});

	test("streams coding session events as SSE with id frames", async () => {
		async function* iterable() {
			yield {
				providerId: "codex",
				sdkSessionId: "session-1",
				sequence: 1,
				event: { type: "text", text: "hello", sessionId: "session-1" },
				createdAt: 10,
			};
			yield {
				providerId: "codex",
				sdkSessionId: "session-1",
				sequence: 2,
				event: { type: "done", sessionId: "session-1", durationMs: 5 },
				createdAt: 20,
			};
		}
		const browserApi = {
			openCodingSessionEventStream: () => iterable(),
		} as unknown as BrowserApi;
		const url = new URL(
			"http://localhost/api/coding/sessions/codex/session-1/events",
		);
		const response = await handleBrowserApiRequest(
			new Request(url),
			url,
			browserApi,
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/event-stream");
		const body = await response.text();
		expect(body).toContain("id: 1\n");
		expect(body).toContain("id: 2\n");
		expect(body).toContain('"text":"hello"');
		expect(body).toContain('"type":"done"');
	});

	test("writes an SSE error frame when the iterable throws mid-stream", async () => {
		async function* iterable() {
			yield {
				providerId: "codex",
				sdkSessionId: "session-1",
				sequence: 1,
				event: { type: "text", text: "partial", sessionId: "session-1" },
				createdAt: 10,
			};
			throw new Error("upstream boom");
		}
		const browserApi = {
			openCodingSessionEventStream: () => iterable(),
		} as unknown as BrowserApi;
		const url = new URL(
			"http://localhost/api/coding/sessions/codex/session-1/events",
		);
		const response = await handleBrowserApiRequest(
			new Request(url),
			url,
			browserApi,
		);
		const body = await response.text();
		expect(body).toContain("id: 1\n");
		expect(body).toContain("event: error\n");
		expect(body).toContain('"message":"upstream boom"');
	});

	test("falls back to Last-Event-ID when sinceSequence is absent", async () => {
		let observedSince: number | undefined;
		async function* iterable() {
			// no yields
		}
		const browserApi = {
			openCodingSessionEventStream: (params: { sinceSequence?: number }) => {
				observedSince = params.sinceSequence;
				return iterable();
			},
		} as unknown as BrowserApi;
		const url = new URL(
			"http://localhost/api/coding/sessions/codex/session-1/events",
		);
		const response = await handleBrowserApiRequest(
			new Request(url, { headers: { "Last-Event-ID": "5" } }),
			url,
			browserApi,
		);
		await response.text();
		expect(observedSince).toBe(5);
	});

	test("passes follow=false to coding event streams for replay-only clients", async () => {
		let observedFollow: boolean | undefined;
		async function* iterable() {
			// no yields
		}
		const browserApi = {
			openCodingSessionEventStream: (params: { follow?: boolean }) => {
				observedFollow = params.follow;
				return iterable();
			},
		} as unknown as BrowserApi;
		const url = new URL(
			"http://localhost/api/coding/sessions/codex/session-1/events?follow=false",
		);

		const response = await handleBrowserApiRequest(
			new Request(url),
			url,
			browserApi,
		);

		await response.text();
		expect(observedFollow).toBe(false);
	});

	test("prefers the larger of sinceSequence query and Last-Event-ID header", async () => {
		let observedSince: number | undefined;
		async function* iterable() {
			// no yields
		}
		const browserApi = {
			openCodingSessionEventStream: (params: { sinceSequence?: number }) => {
				observedSince = params.sinceSequence;
				return iterable();
			},
		} as unknown as BrowserApi;
		const url = new URL(
			"http://localhost/api/coding/sessions/codex/session-1/events?sinceSequence=3",
		);
		const response = await handleBrowserApiRequest(
			new Request(url, { headers: { "Last-Event-ID": "7" } }),
			url,
			browserApi,
		);
		await response.text();
		expect(observedSince).toBe(7);
	});
});
