import {
	afterEach,
	beforeEach,
	describe,
	expect,
	setSystemTime,
	test,
	vi,
} from "bun:test";
import type {
	DisplayMessage,
	UsageInfo,
} from "../../../src/common/protocol.ts";
import { ensureRunningChatSession } from "../../../src/frontend/browser/ensure-running-chat-session.ts";
import {
	createLiveRunSessionRouter,
	routeLiveRunSessionKey,
} from "../../../src/frontend/browser/live-run-session.ts";
import { useAgentsStore } from "../../../src/frontend/browser/stores/agents.ts";
import { useChatStore } from "../../../src/frontend/browser/stores/chat.ts";
import { useContextUsageStore } from "../../../src/frontend/browser/stores/context-usage.ts";
import {
	selectVisibleRuntimeNotice,
	useRuntimeStore,
} from "../../../src/frontend/browser/stores/runtime.ts";
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

	afterEach(() => {
		vi.useRealTimers();
		setSystemTime();
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

	test("sessions store removes sessions across agents by sdk session id", () => {
		const REMOTE_SESSION: SessionEntry = {
			agentId: "agent-b",
			providerId: "claude",
			sdkSessionId: "sdk-alpha",
			title: "Remote alpha",
			model: "sonnet",
			lastActive: 70,
		};
		useSessionsStore
			.getState()
			.setSessions("agent-a", [
				SESSION_ALPHA,
				SESSION_BETA,
				SESSION_OTHER_PROVIDER,
			]);
		useSessionsStore.getState().setSessions("agent-b", [REMOTE_SESSION]);
		useSessionsStore.getState().setActiveSession("agent-a", {
			agentId: "agent-a",
			providerId: "claude",
			sdkSessionId: "sdk-alpha",
		});
		useSessionsStore.getState().setActiveSession("agent-b", {
			agentId: "agent-b",
			providerId: "claude",
			sdkSessionId: "sdk-alpha",
		});

		useSessionsStore.getState().deleteSessionBySdkId("sdk-alpha");

		expect(useSessionsStore.getState().sessionsByAgent["agent-a"]).toEqual([
			SESSION_BETA,
		]);
		expect(useSessionsStore.getState().sessionsByAgent["agent-b"]).toEqual([]);
		expect(
			useSessionsStore.getState().activeSessionByAgent["agent-a"],
		).toBeNull();
		expect(
			useSessionsStore.getState().activeSessionByAgent["agent-b"],
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

		useTabsStore.getState().openTab({
			type: "git-commit",
			id: "git-commit:abc1234",
			sha: "abc1234",
			title: "Second commit",
		});
		useTabsStore.getState().openTab({
			type: "git-commit",
			id: "git-commit:abc1234",
			sha: "abc1234",
			title: "Second commit",
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
			{
				type: "git-commit",
				id: "git-commit:abc1234",
				sha: "abc1234",
				title: "Second commit",
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

	test("runtime store keeps a dismissed rollover hidden until the notice changes", () => {
		useRuntimeStore.getState().updateFromStatus({
			type: "runtime_status",
			agentName: "railly",
			providerId: "claude",
			model: "opus",
			effort: "high",
			running: false,
			notice: {
				kind: "rollover",
				message: "Session rolled over after idle timeout.",
			},
		});

		expect(selectVisibleRuntimeNotice(useRuntimeStore.getState())).toEqual({
			kind: "rollover",
			message: "Session rolled over after idle timeout.",
		});

		useRuntimeStore.getState().dismissNotice();

		expect(selectVisibleRuntimeNotice(useRuntimeStore.getState())).toBeNull();

		useRuntimeStore.getState().updateFromStatus({
			type: "runtime_status",
			agentName: "railly",
			providerId: "claude",
			model: "opus",
			effort: "high",
			running: false,
			notice: {
				kind: "rollover",
				message: "Session rolled over after idle timeout.",
			},
		});

		expect(selectVisibleRuntimeNotice(useRuntimeStore.getState())).toBeNull();

		useRuntimeStore.getState().updateFromStatus({
			type: "runtime_status",
			agentName: "railly",
			providerId: "claude",
			model: "opus",
			effort: "high",
			running: false,
			notice: {
				kind: "rollover",
				message: "Session rolled over again after a later idle timeout.",
			},
		});

		expect(selectVisibleRuntimeNotice(useRuntimeStore.getState())).toEqual({
			kind: "rollover",
			message: "Session rolled over again after a later idle timeout.",
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

	test("chat store can stamp finalized live turns with timestamps", () => {
		const sessionKey = "agent-a:claude:sdk-alpha";
		const promptTimestamp = new Date("2025-01-15T14:30:00.000Z");
		const replyTimestamp = new Date("2025-01-15T14:31:04.000Z");

		setSystemTime(promptTimestamp);
		vi.useFakeTimers({ now: promptTimestamp });

		useChatStore.getState().pushMessage(sessionKey, {
			kind: "chat",
			role: "user",
			content: "hello",
			timestamp: Date.now(),
		});
		useChatStore.getState().startAssistantTurn(sessionKey);
		useChatStore.getState().appendText(sessionKey, "world");

		setSystemTime(replyTimestamp);
		useChatStore.getState().finalizeMessage(sessionKey, {
			timestamp: Date.now(),
		});

		expect(useChatStore.getState().getMessages(sessionKey)).toEqual([
			{
				kind: "chat",
				role: "user",
				content: "hello",
				timestamp: promptTimestamp.getTime(),
			},
			{
				kind: "chat",
				role: "assistant",
				content: "world",
				timestamp: replyTimestamp.getTime(),
				assistantTurn: {
					source: "user",
					startedAt: promptTimestamp.getTime(),
					durationMs: replyTimestamp.getTime() - promptTimestamp.getTime(),
				},
			},
		]);
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

	test("ensureRunningChatSession prefers the runtime session when sidebar session state is stale", () => {
		useAgentsStore
			.getState()
			.setAgents([{ agentId: "agent-a", name: "alpha" }]);
		useAgentsStore.getState().setActiveAgent("agent-a");
		useSessionsStore.getState().setActiveSession("agent-a", {
			agentId: "agent-a",
			providerId: "claude",
			sdkSessionId: "sdk-stale",
		});
		useRuntimeStore.getState().updateFromStatus({
			type: "runtime_status",
			agentName: "alpha",
			providerId: "claude",
			model: "sonnet",
			effort: "think",
			running: true,
			sessionId: "sdk-live",
			sessionTitle: "Live session",
		});

		ensureRunningChatSession("agent-a", "claude");

		expect(
			useChatStore.getState().getSession("agent-a:claude:sdk-stale"),
		).toBeUndefined();
		const session = useChatStore
			.getState()
			.getSession("agent-a:claude:sdk-live");
		expect(session?.isStreaming).toBe(true);
		expect(session?.isThinking).toBe(true);
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

	test("chat store restores the full buffered partial stream after history replay", () => {
		useChatStore.getState().pushMessage("agent-a:claude:sdk-alpha", {
			kind: "chat",
			role: "user",
			content: "hello",
		});
		useChatStore.getState().startAssistantTurn("agent-a:claude:sdk-alpha");
		useChatStore.getState().appendText("agent-a:claude:sdk-alpha", "Hel");

		useChatStore.getState().replaceHistory(
			"agent-a:claude:sdk-alpha",
			[
				{
					kind: "chat",
					role: "user",
					content: "hello",
				},
			],
			{ preservePendingTurn: true },
		);
		useChatStore.getState().restoreStreamingState("agent-a:claude:sdk-alpha", {
			images: [],
			text: "Hello there",
			thinking: "",
		});
		useChatStore.getState().appendText("agent-a:claude:sdk-alpha", "!");
		useChatStore.getState().finalizeMessage("agent-a:claude:sdk-alpha");

		expect(
			useChatStore.getState().getMessages("agent-a:claude:sdk-alpha"),
		).toEqual([
			{
				kind: "chat",
				role: "user",
				content: "hello",
			},
			{
				kind: "chat",
				role: "assistant",
				content: "Hello there!",
			},
		]);
	});

	test("chat store hides replayed heartbeat noop turns", () => {
		useChatStore.getState().replaceHistory("agent-a:claude:sdk-alpha", [
			{
				kind: "system",
				event: "heartbeat",
				text: "Heartbeat",
			},
			{
				kind: "chat",
				role: "assistant",
				content: " `HEARTBEAT_OK` ",
			},
		]);

		expect(
			useChatStore.getState().getMessages("agent-a:claude:sdk-alpha"),
		).toEqual([]);
	});

	test("chat store compacts raw replayed heartbeat prompts and keeps substantive results", () => {
		useChatStore.getState().replaceHistory("agent-a:claude:sdk-alpha", [
			{
				kind: "chat",
				role: "user",
				content:
					"Read HEARTBEAT.md and follow its instructions. Only act on what the file currently says — do not repeat tasks from earlier heartbeats or infer tasks from conversation history. If you took any action or have anything to report, summarise briefly. If you did nothing and have nothing to notify the user about, reply with exactly `HEARTBEAT_OK` — no other text.",
			},
			{
				kind: "chat",
				role: "assistant",
				content: "Updated inbox triage notes.",
			},
		]);

		expect(
			useChatStore.getState().getMessages("agent-a:claude:sdk-alpha"),
		).toEqual([
			{
				kind: "system",
				event: "heartbeat",
				text: "Heartbeat",
			},
			{
				kind: "chat",
				role: "assistant",
				content: "Updated inbox triage notes.",
				assistantTurn: {
					source: "heartbeat",
				},
			},
		]);
	});

	test("chat store locks replayed user turn durations before operational turns", () => {
		const userTimestamp = Date.parse("2025-01-15T14:30:00.000Z");
		const assistantTimestamp = Date.parse("2025-01-15T14:33:20.000Z");
		const heartbeatTimestamp = Date.parse("2025-01-15T14:40:30.000Z");

		useChatStore.getState().replaceHistory("agent-a:claude:sdk-alpha", [
			{
				kind: "chat",
				role: "user",
				content: "hello",
				timestamp: userTimestamp,
			},
			{
				kind: "chat",
				role: "assistant",
				content: "done",
				timestamp: assistantTimestamp,
			},
			{
				kind: "system",
				event: "heartbeat",
				text: "Heartbeat",
			},
			{
				kind: "chat",
				role: "assistant",
				content: "Heartbeat result",
				timestamp: heartbeatTimestamp,
			},
		]);

		expect(
			useChatStore.getState().getMessages("agent-a:claude:sdk-alpha"),
		).toEqual([
			{
				kind: "chat",
				role: "user",
				content: "hello",
				timestamp: userTimestamp,
			},
			{
				kind: "chat",
				role: "assistant",
				content: "done",
				timestamp: assistantTimestamp,
				assistantTurn: {
					source: "user",
					startedAt: userTimestamp,
					durationMs: assistantTimestamp - userTimestamp,
				},
			},
			{
				kind: "system",
				event: "heartbeat",
				text: "Heartbeat",
			},
			{
				kind: "chat",
				role: "assistant",
				content: "Heartbeat result",
				timestamp: heartbeatTimestamp,
				assistantTurn: {
					source: "heartbeat",
				},
			},
		]);
	});

	test("chat store hides raw replayed heartbeat noop prompts", () => {
		useChatStore.getState().replaceHistory("agent-a:claude:sdk-alpha", [
			{
				kind: "chat",
				role: "user",
				content:
					"Read HEARTBEAT.md and follow its instructions. Only act on what the file currently says — do not repeat tasks from earlier heartbeats or infer tasks from conversation history. If you took any action or have anything to report, summarise briefly. If you did nothing and have nothing to notify the user about, reply with exactly `HEARTBEAT_OK` — no other text.",
			},
			{
				kind: "chat",
				role: "assistant",
				content: "HEARTBEAT_OK",
			},
		]);

		expect(
			useChatStore.getState().getMessages("agent-a:claude:sdk-alpha"),
		).toEqual([]);
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

	test("chat store can clear all pending sessions for one agent", () => {
		useChatStore.getState().replaceHistory("agent-a:runtime:__pending__", [
			{
				kind: "system",
				event: "heartbeat",
				text: "Heartbeat",
			},
		]);
		useChatStore.getState().replaceHistory("agent-a:claude:__pending__", [
			{
				kind: "system",
				event: "compact_boundary",
				text: "Context compacted",
				trigger: "auto",
				preTokens: 123,
			},
		]);
		useChatStore.getState().replaceHistory("agent-a:claude:sdk-alpha", [
			{
				kind: "chat",
				role: "user",
				content: "keep me",
			},
		]);
		useChatStore.getState().replaceHistory("agent-b:claude:__pending__", [
			{
				kind: "chat",
				role: "user",
				content: "other agent",
			},
		]);

		useChatStore.getState().clearPendingSessions("agent-a");

		expect(
			useChatStore.getState().getSession("agent-a:runtime:__pending__"),
		).toBeUndefined();
		expect(
			useChatStore.getState().getSession("agent-a:claude:__pending__"),
		).toBeUndefined();
		expect(
			useChatStore.getState().getMessages("agent-a:claude:sdk-alpha"),
		).toEqual([
			{
				kind: "chat",
				role: "user",
				content: "keep me",
			},
		]);
		expect(
			useChatStore.getState().getMessages("agent-b:claude:__pending__"),
		).toEqual([
			{
				kind: "chat",
				role: "user",
				content: "other agent",
			},
		]);
	});

	test("chat store drops a heartbeat indicator when the final heartbeat result is only HEARTBEAT_OK", () => {
		useChatStore.getState().pushMessage("agent-a:claude:sdk-alpha", {
			kind: "system",
			event: "heartbeat",
			text: "Heartbeat",
		});
		useChatStore
			.getState()
			.appendText("agent-a:claude:sdk-alpha", "  `HEARTBEAT_OK`  ");

		useChatStore.getState().finalizeMessage("agent-a:claude:sdk-alpha");

		expect(
			useChatStore.getState().getMessages("agent-a:claude:sdk-alpha"),
		).toEqual([]);
	});

	test("history replay keeps a running heartbeat hidden when status arrives first", () => {
		const sessionKey = "agent-a:claude:sdk-alpha";

		useChatStore.getState().startAssistantTurn(sessionKey);
		useChatStore.getState().replaceHistory(sessionKey, [
			{
				kind: "system",
				event: "heartbeat",
				text: "Heartbeat",
			},
		]);
		useChatStore.getState().appendText(sessionKey, "`HEARTBEAT_OK`");

		useChatStore.getState().finalizeMessage(sessionKey);

		expect(useChatStore.getState().getMessages(sessionKey)).toEqual([]);
	});

	test("startAssistantTurn restores pending heartbeat cleanup when replay arrives first", () => {
		const sessionKey = "agent-a:claude:sdk-alpha";

		useChatStore.getState().replaceHistory(sessionKey, [
			{
				kind: "system",
				event: "heartbeat",
				text: "Heartbeat",
			},
		]);
		useChatStore.getState().startAssistantTurn(sessionKey);
		useChatStore.getState().appendText(sessionKey, "`HEARTBEAT_OK`");

		useChatStore.getState().finalizeMessage(sessionKey);

		expect(useChatStore.getState().getMessages(sessionKey)).toEqual([]);
	});

	test("heartbeat cleanup stays with the originating session across a session switch", () => {
		const router = createLiveRunSessionRouter();
		const sessionAKey = "agent-a:claude:sdk-alpha";
		const sessionBKey = "agent-a:claude:sdk-beta";

		useChatStore.getState().replaceHistory(sessionBKey, [
			{
				kind: "chat",
				role: "user",
				content: "keep session B clean",
			},
		]);
		useChatStore.getState().pushMessage(router.pin(sessionAKey), {
			kind: "system",
			event: "heartbeat",
			text: "Heartbeat",
		});

		useChatStore
			.getState()
			.appendText(router.route(sessionBKey), "`HEARTBEAT_OK`");

		const completion = router.complete(sessionAKey, sessionBKey);
		if (completion.adoptFromSessionKey) {
			useChatStore
				.getState()
				.adoptSession(completion.adoptFromSessionKey, completion.sessionKey);
		}
		useChatStore.getState().finalizeMessage(completion.sessionKey);

		expect(useChatStore.getState().getMessages(sessionAKey)).toEqual([]);
		expect(useChatStore.getState().getMessages(sessionBKey)).toEqual([
			{
				kind: "chat",
				role: "user",
				content: "keep session B clean",
			},
		]);
	});

	test("late heartbeat output still cleans up the originating session when the browser missed the prompt", () => {
		const router = createLiveRunSessionRouter();
		const sessionAKey = "agent-a:claude:sdk-alpha";
		const sessionBKey = "agent-a:claude:sdk-beta";

		useChatStore.getState().replaceHistory(sessionBKey, [
			{
				kind: "chat",
				role: "user",
				content: "keep session B clean",
			},
		]);
		useChatStore.getState().pushMessage(sessionAKey, {
			kind: "system",
			event: "heartbeat",
			text: "Heartbeat",
		});

		const routedSessionKey = routeLiveRunSessionKey({
			agentId: "agent-a",
			fallbackSessionKey: sessionBKey,
			observedSessionId: "sdk-alpha",
			providerId: "claude",
			router,
		});
		useChatStore.getState().appendText(routedSessionKey, "`HEARTBEAT_OK`");

		const completion = router.complete(sessionAKey, sessionBKey);
		if (completion.adoptFromSessionKey) {
			useChatStore
				.getState()
				.adoptSession(completion.adoptFromSessionKey, completion.sessionKey);
		}
		useChatStore.getState().finalizeMessage(completion.sessionKey);

		expect(useChatStore.getState().getMessages(sessionAKey)).toEqual([]);
		expect(useChatStore.getState().getMessages(sessionBKey)).toEqual([
			{
				kind: "chat",
				role: "user",
				content: "keep session B clean",
			},
		]);
	});

	test("chat store keeps heartbeat indicator and result when the heartbeat produced content", () => {
		useChatStore.getState().pushMessage("agent-a:claude:sdk-alpha", {
			kind: "system",
			event: "heartbeat",
			text: "Heartbeat",
		});
		useChatStore
			.getState()
			.appendThinking("agent-a:claude:sdk-alpha", "checking tasks");
		useChatStore
			.getState()
			.appendText("agent-a:claude:sdk-alpha", "Updated inbox triage notes.");

		useChatStore.getState().finalizeMessage("agent-a:claude:sdk-alpha");

		expect(
			useChatStore.getState().getMessages("agent-a:claude:sdk-alpha"),
		).toEqual([
			{
				kind: "system",
				event: "heartbeat",
				text: "Heartbeat",
			},
			{
				kind: "chat",
				role: "assistant",
				content: "Updated inbox triage notes.",
				thinking: "checking tasks",
				assistantTurn: {
					source: "heartbeat",
				},
			},
		]);
	});

	test("chat store locks user turn duration before later heartbeat output", () => {
		const sessionKey = "agent-a:claude:sdk-alpha";
		const userTimestamp = Date.parse("2025-01-15T14:30:00.000Z");
		const assistantTimestamp = Date.parse("2025-01-15T14:33:20.000Z");
		const heartbeatTimestamp = Date.parse("2025-01-15T14:40:30.000Z");

		useChatStore.getState().pushMessage(sessionKey, {
			kind: "chat",
			role: "user",
			content: "hello",
			timestamp: userTimestamp,
		});
		useChatStore.getState().appendText(sessionKey, "done");
		useChatStore.getState().finalizeMessage(sessionKey, {
			timestamp: assistantTimestamp,
		});
		useChatStore.getState().pushMessage(sessionKey, {
			kind: "system",
			event: "heartbeat",
			text: "Heartbeat",
		});
		useChatStore.getState().appendText(sessionKey, "Heartbeat result");
		useChatStore.getState().finalizeMessage(sessionKey, {
			timestamp: heartbeatTimestamp,
		});

		expect(useChatStore.getState().getMessages(sessionKey)).toEqual([
			{
				kind: "chat",
				role: "user",
				content: "hello",
				timestamp: userTimestamp,
			},
			{
				kind: "chat",
				role: "assistant",
				content: "done",
				thinking: undefined,
				timestamp: assistantTimestamp,
				assistantTurn: {
					source: "user",
					startedAt: userTimestamp,
					durationMs: assistantTimestamp - userTimestamp,
				},
			},
			{
				kind: "system",
				event: "heartbeat",
				text: "Heartbeat",
			},
			{
				kind: "chat",
				role: "assistant",
				content: "Heartbeat result",
				thinking: undefined,
				timestamp: heartbeatTimestamp,
				assistantTurn: {
					source: "heartbeat",
				},
			},
		]);
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
