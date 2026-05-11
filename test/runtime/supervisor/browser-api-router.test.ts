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
			writeAgentFile: async (agentId, path, content, expected) => {
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
