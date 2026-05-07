import { describe, expect, test } from "bun:test";
import {
	SESSION_SEARCH_QUERY_MAX_LENGTH,
	sessionSearchQueryTooLongMessage,
} from "../../../src/runtime/application/session-search-query.ts";
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
});
