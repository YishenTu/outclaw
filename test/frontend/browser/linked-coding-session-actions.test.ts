import { afterEach, describe, expect, test } from "bun:test";
import { openLatestLinkedCodingSessionForActiveChat } from "../../../src/frontend/browser/coding/linked-coding-session-actions.ts";
import { createBrowserSessionRef } from "../../../src/frontend/browser/sessions/session.ts";
import { useAgentsStore } from "../../../src/frontend/browser/stores/agents.ts";
import { useRuntimePopupStore } from "../../../src/frontend/browser/stores/runtime-popup.ts";
import { useSessionsStore } from "../../../src/frontend/browser/stores/sessions.ts";
import { CHAT_TAB } from "../../../src/frontend/browser/stores/tab-policy.ts";
import { useTabsStore } from "../../../src/frontend/browser/stores/tabs.ts";

function resetStore<TState>(store: {
	getInitialState(): TState;
	setState(state: TState, replace: true): void;
}) {
	store.setState(store.getInitialState(), true);
}

function resetBrowserStores() {
	resetStore(useAgentsStore);
	resetStore(useSessionsStore);
	resetStore(useRuntimePopupStore);
	resetStore(useTabsStore);
}

describe("linked coding session actions", () => {
	afterEach(() => {
		resetBrowserStores();
	});

	test("opens only the latest linked coding session for the active chat", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			const url = new URL(String(input), "http://localhost");
			expect(url.pathname).toBe(
				"/api/agents/agent-railly/sessions/claude/chat-1/coding-links",
			);
			return Response.json({
				sessions: [
					{
						providerId: "codex",
						sdkSessionId: "code-latest",
						repositoryId: "repo-1",
						title: "Latest coding task",
						model: "gpt-5.5",
						lastActive: 300,
						cwd: "/workspace/outclaw",
						lifecycleStatus: "open",
						runStatus: "running",
						createdAt: 250,
						source: "code",
						tag: "code",
					},
					{
						providerId: "codex",
						sdkSessionId: "code-older",
						repositoryId: "repo-1",
						title: "Older coding task",
						model: "gpt-5.5",
						lastActive: 100,
						cwd: "/workspace/outclaw",
						lifecycleStatus: "open",
						runStatus: "idle",
						createdAt: 50,
						source: "code",
						tag: "code",
					},
				],
			});
		}) as unknown as typeof fetch;
		try {
			useAgentsStore.getState().setActiveAgent("agent-railly");
			useSessionsStore
				.getState()
				.setActiveSession(
					"agent-railly",
					createBrowserSessionRef("agent-railly", "claude", "chat-1"),
				);

			await expect(openLatestLinkedCodingSessionForActiveChat()).resolves.toBe(
				true,
			);

			expect(useTabsStore.getState().activeTabId).toBe(
				"coding:repo-1:codex:code-latest",
			);
			expect(useTabsStore.getState().tabs).toEqual([
				CHAT_TAB,
				{
					type: "coding-session",
					id: "coding:repo-1:codex:code-latest",
					providerId: "codex",
					sdkSessionId: "code-latest",
					repositoryId: "repo-1",
					title: "Latest coding task",
				},
			]);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("reports an empty active chat instead of falling back to global code mode", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			Response.json({ sessions: [] })) as unknown as typeof fetch;
		try {
			useAgentsStore.getState().setActiveAgent("agent-railly");
			useSessionsStore
				.getState()
				.setActiveSession(
					"agent-railly",
					createBrowserSessionRef("agent-railly", "claude", "chat-1"),
				);

			await expect(openLatestLinkedCodingSessionForActiveChat()).resolves.toBe(
				false,
			);

			expect(useTabsStore.getState().tabs).toEqual([CHAT_TAB]);
			expect(useRuntimePopupStore.getState().popup).toEqual({
				kind: "status",
				text: "No linked coding sessions for this chat.",
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("reports coding link lookup failures without throwing", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			Response.json(
				{ error: "Coding links unavailable" },
				{ status: 503 },
			)) as unknown as typeof fetch;
		try {
			useAgentsStore.getState().setActiveAgent("agent-railly");
			useSessionsStore
				.getState()
				.setActiveSession(
					"agent-railly",
					createBrowserSessionRef("agent-railly", "claude", "chat-1"),
				);

			await expect(openLatestLinkedCodingSessionForActiveChat()).resolves.toBe(
				false,
			);

			expect(useTabsStore.getState().tabs).toEqual([CHAT_TAB]);
			expect(useRuntimePopupStore.getState().popup).toEqual({
				kind: "status",
				text: "Unable to open linked coding session: Coding links unavailable",
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
