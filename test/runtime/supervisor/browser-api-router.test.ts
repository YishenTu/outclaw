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
						archivedAt: 40,
					},
				};
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

		expect(calls).toEqual([
			"repo:list:true",
			"repo:register:/workspace/outclaw:Outclaw:manual",
			"repo:get:repo-1",
			"repo:archive:repo-1",
		]);
	});

	test("routes coding session list requests with cursor and linked chat filters", async () => {
		let params:
			| {
					limit: number;
					cursor?: { lastActive: number; sdkSessionId: string };
					linkedChatSessionId?: string;
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
			"http://localhost/api/coding/sessions?limit=5&cursorLastActive=20&cursorSdkSessionId=code-1&providerId=codex&repositoryId=repo-1&linkedChatSessionId=chat-1",
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
			providerId: "codex",
			repositoryId: "repo-1",
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
});
