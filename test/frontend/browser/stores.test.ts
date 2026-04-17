import { beforeEach, describe, expect, test } from "bun:test";
import type {
	DisplayMessage,
	UsageInfo,
} from "../../../src/common/protocol.ts";
import { ensureRunningChatSession } from "../../../src/frontend/browser/ensure-running-chat-session.ts";
import { useAgentsStore } from "../../../src/frontend/browser/stores/agents.ts";
import { useChatStore } from "../../../src/frontend/browser/stores/chat.ts";
import { useContextUsageStore } from "../../../src/frontend/browser/stores/context-usage.ts";
import { useRuntimeStore } from "../../../src/frontend/browser/stores/runtime.ts";
import {
	type SessionEntry,
	type SessionRef,
	useSessionsStore,
} from "../../../src/frontend/browser/stores/sessions.ts";
import { useTabsStore } from "../../../src/frontend/browser/stores/tabs.ts";

const SESSION_ALPHA: SessionEntry = {
	agentId: "agent-a",
	providerId: "claude",
	sdkSessionId: "sdk-alpha",
	title: "Alpha",
	model: "sonnet",
	lastActive: 100,
};

const SESSION_BETA: SessionEntry = {
	agentId: "agent-a",
	providerId: "claude",
	sdkSessionId: "sdk-beta",
	title: "Beta",
	model: "sonnet",
	lastActive: 90,
};

const SESSION_OTHER_PROVIDER: SessionEntry = {
	agentId: "agent-a",
	providerId: "mock",
	sdkSessionId: "sdk-alpha",
	title: "Other",
	model: "mock-model",
	lastActive: 80,
};

function resetStore<TState>(store: {
	getInitialState(): TState;
	setState(state: TState, replace: true): void;
}) {
	store.setState(store.getInitialState(), true);
}

describe("browser stores", () => {
	beforeEach(() => {
		resetStore(useAgentsStore);
		resetStore(useSessionsStore);
		resetStore(useTabsStore);
		resetStore(useChatStore);
		resetStore(useContextUsageStore);
		resetStore(useRuntimeStore);
	});

	test("agents store tracks agent list and active agent", () => {
		useAgentsStore.getState().setAgents([
			{ agentId: "agent-a", name: "alpha" },
			{ agentId: "agent-b", name: "beta" },
		]);
		useAgentsStore.getState().setActiveAgent("agent-b");

		expect(useAgentsStore.getState().agents).toEqual([
			{ agentId: "agent-a", name: "alpha" },
			{ agentId: "agent-b", name: "beta" },
		]);
		expect(useAgentsStore.getState().activeAgentId).toBe("agent-b");
	});

	test("agents store preserves browser-side reordered agent order across refreshes", () => {
		useAgentsStore.getState().setAgents([
			{ agentId: "agent-a", name: "alpha" },
			{ agentId: "agent-b", name: "beta" },
			{ agentId: "agent-c", name: "gamma" },
		]);

		useAgentsStore.getState().reorderAgents("agent-c", "agent-a", "before");

		expect(
			useAgentsStore.getState().agents.map((agent) => agent.agentId),
		).toEqual(["agent-c", "agent-a", "agent-b"]);

		useAgentsStore.getState().setAgents([
			{ agentId: "agent-a", name: "alpha" },
			{ agentId: "agent-b", name: "beta" },
			{ agentId: "agent-c", name: "gamma" },
			{ agentId: "agent-d", name: "delta" },
		]);

		expect(
			useAgentsStore.getState().agents.map((agent) => agent.agentId),
		).toEqual(["agent-c", "agent-a", "agent-b", "agent-d"]);
	});

	test("agents store inserts before the hovered agent when dragging downward", () => {
		useAgentsStore.getState().setAgents([
			{ agentId: "agent-a", name: "alpha" },
			{ agentId: "agent-b", name: "beta" },
			{ agentId: "agent-c", name: "gamma" },
			{ agentId: "agent-d", name: "delta" },
		]);

		useAgentsStore.getState().reorderAgents("agent-a", "agent-c", "before");

		expect(
			useAgentsStore.getState().agents.map((agent) => agent.agentId),
		).toEqual(["agent-b", "agent-a", "agent-c", "agent-d"]);
	});

	test("agents store inserts after the hovered agent when requested", () => {
		useAgentsStore.getState().setAgents([
			{ agentId: "agent-a", name: "alpha" },
			{ agentId: "agent-b", name: "beta" },
			{ agentId: "agent-c", name: "gamma" },
			{ agentId: "agent-d", name: "delta" },
		]);

		useAgentsStore.getState().reorderAgents("agent-a", "agent-c", "after");

		expect(
			useAgentsStore.getState().agents.map((agent) => agent.agentId),
		).toEqual(["agent-b", "agent-c", "agent-a", "agent-d"]);
	});

	test("sessions store applies provider-aware rename and delete", () => {
		useSessionsStore
			.getState()
			.setSessions("agent-a", [
				SESSION_ALPHA,
				SESSION_BETA,
				SESSION_OTHER_PROVIDER,
			]);
		useSessionsStore.getState().setActiveSession("agent-a", {
			agentId: "agent-a",
			providerId: "claude",
			sdkSessionId: "sdk-alpha",
		});

		const target: SessionRef = {
			agentId: "agent-a",
			providerId: "claude",
			sdkSessionId: "sdk-alpha",
		};
		useSessionsStore.getState().renameSession(target, "Renamed");

		expect(useSessionsStore.getState().sessionsByAgent["agent-a"]).toEqual([
			{ ...SESSION_ALPHA, title: "Renamed" },
			SESSION_BETA,
			SESSION_OTHER_PROVIDER,
		]);

		useSessionsStore.getState().deleteSession(target);

		expect(useSessionsStore.getState().sessionsByAgent["agent-a"]).toEqual([
			SESSION_BETA,
			SESSION_OTHER_PROVIDER,
		]);
		expect(
			useSessionsStore.getState().activeSessionByAgent["agent-a"],
		).toBeNull();
	});

	test("tabs store preserves the permanent chat tab", () => {
		useTabsStore.getState().openTab({
			type: "file",
			id: "agent-a:AGENTS.md",
			agentId: "agent-a",
			path: "AGENTS.md",
		});
		useTabsStore.getState().openTab({
			type: "file",
			id: "agent-a:AGENTS.md",
			agentId: "agent-a",
			path: "AGENTS.md",
		});

		expect(useTabsStore.getState().tabs).toEqual([
			{ type: "chat", id: "chat" },
			{
				type: "file",
				id: "agent-a:AGENTS.md",
				agentId: "agent-a",
				path: "AGENTS.md",
			},
		]);

		useTabsStore.getState().openTab({
			type: "git-diff",
			id: "git-diff:AGENTS.md",
			path: "AGENTS.md",
		});
		useTabsStore.getState().openTab({
			type: "git-diff",
			id: "git-diff:AGENTS.md",
			path: "AGENTS.md",
		});

		expect(useTabsStore.getState().tabs).toEqual([
			{ type: "chat", id: "chat" },
			{
				type: "file",
				id: "agent-a:AGENTS.md",
				agentId: "agent-a",
				path: "AGENTS.md",
			},
			{
				type: "git-diff",
				id: "git-diff:AGENTS.md",
				path: "AGENTS.md",
			},
		]);

		useTabsStore.getState().closeTab("chat");
		expect(useTabsStore.getState().tabs[0]).toEqual({
			type: "chat",
			id: "chat",
		});

		useTabsStore.getState().closeAllFileTabs();
		expect(useTabsStore.getState().tabs).toEqual([
			{ type: "chat", id: "chat" },
		]);
		expect(useTabsStore.getState().activeTabId).toBe("chat");

		useTabsStore.getState().setScrollPosition("agent-a:AGENTS.md", 240);
		expect(useTabsStore.getState().scrollPositions["agent-a:AGENTS.md"]).toBe(
			240,
		);

		useTabsStore.getState().closeTab("agent-a:AGENTS.md");
		expect(
			useTabsStore.getState().scrollPositions["agent-a:AGENTS.md"],
		).toBeUndefined();
	});

	test("runtime store keeps the restart notice when clearing only the session", () => {
		useRuntimeStore.getState().updateFromStatus({
			type: "runtime_status",
			agentName: "railly",
			providerId: "claude",
			model: "opus",
			effort: "high",
			running: false,
			sessionId: "sdk-alpha",
			sessionTitle: "Alpha",
			notice: { kind: "restart_required" },
		});

		useRuntimeStore.getState().clearSession();

		expect(useRuntimeStore.getState().sessionId).toBeNull();
		expect(useRuntimeStore.getState().sessionTitle).toBeNull();
		expect(useRuntimeStore.getState().notice).toEqual({
			kind: "restart_required",
		});
	});

	test("chat store replays history and finalizes streamed assistant text", () => {
		const history: DisplayMessage[] = [
			{
				kind: "chat",
				role: "user",
				content: "hello",
			},
		];

		useChatStore.getState().replaceHistory("agent-a:claude:sdk-alpha", history);
		useChatStore
			.getState()
			.appendThinking("agent-a:claude:sdk-alpha", "reasoning");
		useChatStore.getState().appendText("agent-a:claude:sdk-alpha", "done");

		const streamingSession = useChatStore
			.getState()
			.getSession("agent-a:claude:sdk-alpha");
		expect(typeof streamingSession?.thinkingStartedAt).toBe("number");

		useChatStore.getState().finalizeMessage("agent-a:claude:sdk-alpha");

		expect(
			useChatStore.getState().getMessages("agent-a:claude:sdk-alpha"),
		).toEqual([
			...history,
			{
				kind: "chat",
				role: "assistant",
				content: "done",
				thinking: "reasoning",
			},
		]);
		const finalizedSession = useChatStore
			.getState()
			.getSession("agent-a:claude:sdk-alpha");
		expect(finalizedSession?.thinkingStartedAt).toBeNull();
		expect(finalizedSession?.streamingText).toBe("");
		expect(finalizedSession?.streamingThinking).toBe("");
		expect(finalizedSession?.isStreaming).toBe(false);
		expect(finalizedSession?.isThinking).toBe(false);
	});

	test("chat store can start optimistic thinking before the first assistant delta", () => {
		useChatStore.getState().pushMessage("agent-a:claude:sdk-alpha", {
			kind: "chat",
			role: "user",
			content: "hello",
		});

		useChatStore.getState().startAssistantTurn("agent-a:claude:sdk-alpha");

		const session = useChatStore
			.getState()
			.getSession("agent-a:claude:sdk-alpha");
		expect(session?.messages).toEqual([
			{
				kind: "chat",
				role: "user",
				content: "hello",
			},
		]);
		expect(session?.isStreaming).toBe(true);
		expect(session?.isThinking).toBe(true);
		expect(typeof session?.thinkingStartedAt).toBe("number");
	});

	test("ensureRunningChatSession starts a pending assistant turn for observed runs", () => {
		useAgentsStore
			.getState()
			.setAgents([{ agentId: "agent-a", name: "alpha" }]);
		useAgentsStore.getState().setActiveAgent("agent-a");
		useRuntimeStore.getState().updateFromStatus({
			type: "runtime_status",
			agentName: "alpha",
			providerId: "claude",
			model: "sonnet",
			effort: "think",
			running: true,
		});

		ensureRunningChatSession("agent-a", "claude");

		const session = useChatStore
			.getState()
			.getSession("agent-a:claude:__pending__");
		expect(session?.isStreaming).toBe(true);
		expect(session?.isThinking).toBe(true);
		expect(typeof session?.thinkingStartedAt).toBe("number");
	});

	test("chat store preserves an active assistant turn across history replay", () => {
		useChatStore.getState().pushMessage("agent-a:claude:sdk-alpha", {
			kind: "chat",
			role: "user",
			content: "hello",
		});
		useChatStore.getState().startAssistantTurn("agent-a:claude:sdk-alpha");

		useChatStore.getState().replaceHistory("agent-a:claude:sdk-alpha", [
			{
				kind: "chat",
				role: "user",
				content: "hello",
			},
		]);

		const session = useChatStore
			.getState()
			.getSession("agent-a:claude:sdk-alpha");
		expect(session?.messages).toEqual([
			{
				kind: "chat",
				role: "user",
				content: "hello",
			},
		]);
		expect(session?.isStreaming).toBe(true);
		expect(session?.isThinking).toBe(true);
		expect(typeof session?.thinkingStartedAt).toBe("number");
	});

	test("chat store can move a pending conversation into a real session key", () => {
		useChatStore.getState().replaceHistory("agent-a:runtime:__pending__", [
			{
				kind: "chat",
				role: "user",
				content: "hello",
			},
		]);
		useChatStore.getState().appendText("agent-a:runtime:__pending__", "done");
		useChatStore
			.getState()
			.adoptSession("agent-a:runtime:__pending__", "agent-a:runtime:sdk-next");
		useChatStore.getState().finalizeMessage("agent-a:runtime:sdk-next");

		expect(
			useChatStore.getState().getMessages("agent-a:runtime:sdk-next"),
		).toEqual([
			{
				kind: "chat",
				role: "user",
				content: "hello",
			},
			{
				kind: "chat",
				role: "assistant",
				content: "done",
				thinking: undefined,
			},
		]);
		expect(
			useChatStore.getState().getSession("agent-a:runtime:__pending__"),
		).toBeUndefined();
	});

	test("context usage store returns the latest usage per session", () => {
		const usage: UsageInfo = {
			inputTokens: 1,
			outputTokens: 2,
			cacheCreationTokens: 3,
			cacheReadTokens: 4,
			contextWindow: 100,
			maxOutputTokens: 50,
			contextTokens: 10,
			percentage: 10,
		};

		useContextUsageStore.getState().setUsage("agent-a:claude:sdk-alpha", usage);

		expect(
			useContextUsageStore.getState().getUsage("agent-a:claude:sdk-alpha"),
		).toEqual(usage);
	});
});
