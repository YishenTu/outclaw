import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import type { UsageInfo } from "../../../src/common/protocol.ts";
import {
	applySidebarSummary,
	formatSessionInfoSummary,
	formatSessionListSummary,
	formatSessionSearchSummary,
	handleBrowserServerEvent,
	inferImageMediaTypeFromPath,
} from "../../../src/frontend/browser/events/runtime-server-events.ts";
import {
	createBrowserSessionRef,
	resolveComposerSessionKey,
} from "../../../src/frontend/browser/sessions/session.ts";
import { useAgentFilesStore } from "../../../src/frontend/browser/stores/agent-files.ts";
import { useAgentsStore } from "../../../src/frontend/browser/stores/agents.ts";
import { useChatStore } from "../../../src/frontend/browser/stores/chat.ts";
import { useContextUsageStore } from "../../../src/frontend/browser/stores/context-usage.ts";
import { useRightPanelRefreshStore } from "../../../src/frontend/browser/stores/right-panel-refresh.ts";
import { useRuntimeStore } from "../../../src/frontend/browser/stores/runtime.ts";
import { useRuntimePopupStore } from "../../../src/frontend/browser/stores/runtime-popup.ts";
import { useSessionsStore } from "../../../src/frontend/browser/stores/sessions.ts";
import { useSlashCommandsStore } from "../../../src/frontend/browser/stores/slash-commands.ts";

const USAGE: UsageInfo = {
	inputTokens: 10,
	outputTokens: 2,
	cacheCreationTokens: 0,
	cacheReadTokens: 3,
	contextTokens: 13,
	contextWindow: 200_000,
	maxOutputTokens: 32_000,
	percentage: 0.0065,
};

function resetStore<TState>(store: {
	getInitialState(): TState;
	setState(state: TState, replace: true): void;
}) {
	store.setState(store.getInitialState(), true);
}

function resetBrowserStores() {
	resetStore(useAgentsStore);
	resetStore(useAgentFilesStore);
	resetStore(useSessionsStore);
	resetStore(useChatStore);
	resetStore(useContextUsageStore);
	resetStore(useRuntimeStore);
	resetStore(useRuntimePopupStore);
	resetStore(useRightPanelRefreshStore);
	resetStore(useSlashCommandsStore);
}

function createHandlerOptions(overrides: Record<string, unknown> = {}) {
	const calls: string[] = [];
	return {
		calls,
		options: {
			bindLiveRunSession: (nextSessionKey: string) => {
				calls.push(`live:bind:${nextSessionKey}`);
				return { sessionKey: nextSessionKey };
			},
			clearLiveRunSessions: () => calls.push("live:clear"),
			completeLiveRunSession: (nextSessionKey: string) => {
				calls.push(`live:complete:${nextSessionKey}`);
				return { sessionKey: nextSessionKey };
			},
			getActiveAgentId: () => useAgentsStore.getState().activeAgentId,
			getCurrentSessionKey: (agentId: string) => `${agentId}:mock:sdk-active`,
			invalidateSidebarRefresh: () => calls.push("sidebar:invalidate"),
			pinObservedSessionKey: (agentId: string, observedSessionId?: string) =>
				`${agentId}:mock:${observedSessionId ?? "observed"}`,
			refreshSidebar: () => calls.push("sidebar:refresh"),
			routeObservedSessionKey: (agentId: string, observedSessionId?: string) =>
				`${agentId}:mock:${observedSessionId ?? "observed"}`,
			...overrides,
		},
	};
}

describe("browser runtime server events", () => {
	afterEach(() => {
		resetBrowserStores();
		setSystemTime();
	});

	test("applies sidebar summaries and formats session summaries", () => {
		applySidebarSummary({
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
							title: "Active",
							model: "mock-model",
							lastActive: 100,
						},
					],
				},
			],
		});

		expect(useAgentsStore.getState().activeAgentId).toBe("agent-railly");
		expect(useAgentsStore.getState().agents).toEqual([
			{
				agentId: "agent-railly",
				name: "railly",
				terminalRunCommand: "bun test",
			},
		]);
		expect(useSessionsStore.getState().sessionsByAgent["agent-railly"]).toEqual(
			[
				{
					agentId: "agent-railly",
					providerId: "mock",
					sdkSessionId: "sdk-active",
					title: "Active",
					model: "mock-model",
					lastActive: 100,
				},
			],
		);
		expect(
			formatSessionListSummary({ type: "session_list", sessions: [] }),
		).toBe("Sessions\nnone");
		expect(
			formatSessionListSummary({
				type: "session_list",
				sessions: [
					{
						sdkSessionId: "sdk-a",
						title: "Alpha",
						model: "opus",
						lastActive: 1,
					},
				],
			}),
		).toBe("Sessions\nAlpha  opus");
		expect(
			formatSessionSearchSummary({
				type: "session_search_result",
				query: "alpha",
				sessions: [
					{
						sdkSessionId: "sdk-a",
						title: "Alpha",
						model: "opus",
						lastActive: 1,
					},
				],
			}),
		).toBe('Session search "alpha"\nAlpha  opus');
		expect(
			formatSessionInfoSummary({
				type: "session_info",
				sdkSessionId: "sdk-a",
				title: "Alpha",
				model: "opus",
			}),
		).toBe("Session\nAlpha\nmodel: opus\nid: sdk-a");
		expect(inferImageMediaTypeFromPath("plot.JPG")).toBe("image/jpeg");
		expect(inferImageMediaTypeFromPath("plot.png")).toBe("image/png");
		expect(inferImageMediaTypeFromPath("plot.gif")).toBe("image/gif");
		expect(inferImageMediaTypeFromPath("plot.webp")).toBe("image/webp");
		expect(inferImageMediaTypeFromPath("plot.svg")).toBeUndefined();
	});

	test("keeps sidebar store identity when a summary is unchanged", () => {
		const summary = {
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
							title: "Active",
							model: "mock-model",
							lastActive: 100,
						},
					],
				},
			],
		};

		applySidebarSummary(summary);
		const agents = useAgentsStore.getState().agents;
		const sessionsByAgent = useSessionsStore.getState().sessionsByAgent;
		const sessions = sessionsByAgent["agent-railly"];
		const activeSession =
			useSessionsStore.getState().activeSessionByAgent["agent-railly"];

		applySidebarSummary(summary);

		expect(useAgentsStore.getState().agents).toBe(agents);
		expect(useSessionsStore.getState().sessionsByAgent).toBe(sessionsByAgent);
		expect(useSessionsStore.getState().sessionsByAgent["agent-railly"]).toBe(
			sessions,
		);
		expect(
			useSessionsStore.getState().activeSessionByAgent["agent-railly"],
		).toBe(activeSession);
	});

	test("refreshes sidebar agent data when the global agents summary is invalidated", () => {
		const { calls, options } = createHandlerOptions();

		handleBrowserServerEvent(
			{
				type: "browser_agents_invalidated",
				agentId: "agent-mimi",
			},
			options,
		);

		expect(calls).toEqual(["sidebar:refresh"]);
	});

	test("clears active sessions from sidebar summaries when no session is active", () => {
		applySidebarSummary({
			activeAgentId: "agent-railly",
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					sessions: [],
				},
			],
		});

		expect(
			useSessionsStore.getState().activeSessionByAgent["agent-railly"],
		).toBeNull();
	});

	test("does not let sidebar refresh bind a pending live run to an empty persisted session", () => {
		setSystemTime(new Date("2026-04-27T00:00:00.000Z"));
		useAgentsStore
			.getState()
			.setAgents([{ agentId: "agent-railly", name: "railly" }]);
		useAgentsStore.getState().setActiveAgent("agent-railly");
		useRuntimeStore.getState().updateFromStatus({
			type: "runtime_status",
			agentName: "railly",
			providerId: "mock",
			model: "opus",
			effort: "medium",
			running: true,
		});
		const pendingSessionKey = "agent-railly:mock:__pending__";
		useChatStore.getState().pushMessage(pendingSessionKey, {
			kind: "chat",
			role: "user",
			content: "new task",
			timestamp: Date.parse("2026-04-27T00:00:00.000Z"),
		});
		useChatStore.getState().startAssistantTurn(pendingSessionKey);

		applySidebarSummary({
			activeAgentId: "agent-railly",
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					terminalRunCommand: "bun test",
					activeSession: {
						providerId: "mock",
						sdkSessionId: "sdk-auto-main",
					},
					sessions: [
						{
							providerId: "mock",
							sdkSessionId: "sdk-auto-main",
							title: "Generated title",
							model: "opus",
							lastActive: 1,
						},
					],
				},
			],
		});

		const activeSession =
			useSessionsStore.getState().activeSessionByAgent["agent-railly"] ?? null;
		const sessionKey = resolveComposerSessionKey({
			agentId: "agent-railly",
			activeSession,
			providerId: useRuntimeStore.getState().providerId,
			runtimeSessionId: useRuntimeStore.getState().sessionId,
		});

		expect(sessionKey).toBe(pendingSessionKey);
		expect(useChatStore.getState().getSession(pendingSessionKey)).toMatchObject(
			{
				messages: [
					{
						kind: "chat",
						role: "user",
						content: "new task",
						timestamp: Date.parse("2026-04-27T00:00:00.000Z"),
					},
				],
				isStreaming: true,
				isThinking: true,
			},
		);
		expect(
			useChatStore.getState().getSession("agent-railly:mock:sdk-auto-main"),
		).toBeUndefined();
		expect(useSessionsStore.getState().sessionsByAgent["agent-railly"]).toEqual(
			[
				{
					agentId: "agent-railly",
					providerId: "mock",
					sdkSessionId: "sdk-auto-main",
					title: "Generated title",
					model: "opus",
					lastActive: 1,
				},
			],
		);
	});

	test("keeps each agent active session when another selected agent is running", () => {
		useAgentsStore.getState().setAgents([
			{ agentId: "agent-railly", name: "railly" },
			{ agentId: "agent-mimi", name: "mimi" },
		]);
		useAgentsStore.getState().setActiveAgent("agent-mimi");
		useRuntimeStore.getState().updateFromStatus({
			type: "runtime_status",
			agentName: "railly",
			providerId: "mock",
			model: "opus",
			effort: "medium",
			running: true,
			sessionId: "sdk-railly",
		});

		applySidebarSummary({
			activeAgentId: "agent-railly",
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					terminalRunCommand: "bun test",
					activeSession: {
						providerId: "mock",
						sdkSessionId: "sdk-stale-railly",
					},
					sessions: [
						{
							providerId: "mock",
							sdkSessionId: "sdk-stale-railly",
							title: "Stale railly active",
							model: "opus",
							lastActive: 2,
						},
					],
				},
				{
					agentId: "agent-mimi",
					name: "mimi",
					terminalRunCommand: "bun test",
					activeSession: {
						providerId: "mock",
						sdkSessionId: "sdk-mimi",
					},
					sessions: [
						{
							providerId: "mock",
							sdkSessionId: "sdk-mimi",
							title: "Mimi active",
							model: "opus",
							lastActive: 1,
						},
					],
				},
			],
		});

		expect(useSessionsStore.getState().activeSessionByAgent).toEqual({
			"agent-mimi": createBrowserSessionRef("agent-mimi", "mock", "sdk-mimi"),
			"agent-railly": createBrowserSessionRef(
				"agent-railly",
				"mock",
				"sdk-railly",
			),
		});
	});

	test("updates runtime, session, usage, and popup state from status events", () => {
		useAgentsStore
			.getState()
			.setAgents([{ agentId: "agent-railly", name: "railly" }]);
		useAgentsStore.getState().setActiveAgent("agent-railly");
		const { options } = createHandlerOptions();

		handleBrowserServerEvent(
			{
				type: "runtime_status",
				agentName: "railly",
				providerId: "mock",
				model: "opus",
				effort: "medium",
				running: true,
				sessionId: "sdk-active",
				sessionTitle: "Active",
				usage: USAGE,
				requested: true,
			},
			options,
		);

		expect(useRuntimeStore.getState()).toMatchObject({
			agentName: "railly",
			providerId: "mock",
			model: "opus",
			effort: "medium",
			running: true,
			sessionId: "sdk-active",
		});
		expect(
			useSessionsStore.getState().activeSessionByAgent["agent-railly"],
		).toEqual({
			agentId: "agent-railly",
			providerId: "mock",
			sdkSessionId: "sdk-active",
		});
		expect(
			useContextUsageStore.getState().getUsage("agent-railly:mock:sdk-active"),
		).toEqual(USAGE);
		expect(useRuntimePopupStore.getState().popup).toMatchObject({
			kind: "status",
		});
		expect(
			useChatStore.getState().getSession("agent-railly:mock:sdk-active")
				?.isStreaming,
		).toBe(true);
	});

	test("handles agent and session control events without provider SDKs", () => {
		useAgentsStore.getState().setAgents([
			{ agentId: "agent-railly", name: "railly" },
			{ agentId: "agent-mimi", name: "mimi" },
		]);
		useAgentsStore.getState().setActiveAgent("agent-railly");
		useRuntimeStore.getState().updateFromStatus({
			type: "runtime_status",
			agentName: "railly",
			providerId: "mock",
			model: "opus",
			effort: "medium",
			running: true,
			sessionId: "sdk-old",
		});
		const { calls, options } = createHandlerOptions();

		handleBrowserServerEvent(
			{ type: "agent_switched", agentId: "agent-mimi", name: "mimi" },
			options,
		);

		expect(useAgentsStore.getState().activeAgentId).toBe("agent-mimi");
		expect(useRuntimeStore.getState()).toMatchObject({
			agentName: "mimi",
			running: false,
			sessionId: null,
		});
		expect(calls).toContain("sidebar:refresh");

		handleBrowserServerEvent(
			{
				type: "session_list",
				sessions: [
					{
						sdkSessionId: "sdk-next",
						title: "Next",
						model: "sonnet",
						lastActive: 1,
					},
				],
			},
			options,
		);
		expect(useRuntimePopupStore.getState().popup).toEqual({
			kind: "status",
			text: "Sessions\nNext  sonnet",
		});

		handleBrowserServerEvent(
			{
				type: "session_search_result",
				query: "next",
				sessions: [
					{
						sdkSessionId: "sdk-next",
						title: "Next",
						model: "sonnet",
						lastActive: 1,
					},
				],
			},
			options,
		);
		expect(useRuntimePopupStore.getState().popup).toEqual({
			kind: "status",
			text: 'Session search "next"\nNext  sonnet',
		});
		useSessionsStore.getState().setSessions("agent-mimi", [
			{
				agentId: "agent-mimi",
				providerId: "mock",
				sdkSessionId: "sdk-next",
				title: "Next",
				model: "sonnet",
				lastActive: 1,
			},
		]);

		handleBrowserServerEvent(
			{ type: "session_switched", sdkSessionId: "sdk-next", title: "Next" },
			options,
		);
		expect(
			useSessionsStore.getState().activeSessionByAgent["agent-mimi"],
		).toEqual(createBrowserSessionRef("agent-mimi", "mock", "sdk-next"));

		handleBrowserServerEvent(
			{ type: "session_renamed", sdkSessionId: "sdk-next", title: "Renamed" },
			options,
		);
		expect(useSessionsStore.getState().sessionsByAgent["agent-mimi"]).toEqual([
			{
				agentId: "agent-mimi",
				providerId: "mock",
				sdkSessionId: "sdk-next",
				title: "Renamed",
				model: "sonnet",
				lastActive: 1,
			},
		]);
		expect(useRuntimePopupStore.getState().popup).toBeNull();
		expect(calls.filter((call) => call === "sidebar:refresh").length).toBe(2);
	});

	test("clears browser session state after a session clear event", () => {
		useAgentsStore
			.getState()
			.setAgents([{ agentId: "agent-railly", name: "railly" }]);
		useAgentsStore.getState().setActiveAgent("agent-railly");
		useRuntimeStore.getState().updateFromStatus({
			type: "runtime_status",
			agentName: "railly",
			providerId: "mock",
			model: "opus",
			effort: "medium",
			running: true,
			sessionId: "sdk-active",
		});
		useSessionsStore
			.getState()
			.setActiveSession(
				"agent-railly",
				createBrowserSessionRef("agent-railly", "mock", "sdk-active"),
			);
		useChatStore.getState().pushMessage("agent-railly:mock:sdk-active", {
			kind: "chat",
			role: "user",
			content: "before clear",
		});
		useChatStore.getState().pushMessage("agent-railly:mock:__pending__", {
			kind: "chat",
			role: "user",
			content: "pending",
		});
		const { calls, options } = createHandlerOptions();

		handleBrowserServerEvent({ type: "session_cleared" }, options);

		expect(
			useSessionsStore.getState().activeSessionByAgent["agent-railly"],
		).toBeNull();
		expect(
			useChatStore.getState().getSession("agent-railly:mock:sdk-active"),
		).toBeUndefined();
		expect(
			useChatStore.getState().getSession("agent-railly:mock:__pending__"),
		).toBeUndefined();
		expect(useRuntimeStore.getState()).toMatchObject({
			running: false,
			sessionId: null,
		});
		expect(calls).toEqual(["sidebar:invalidate", "live:clear"]);
	});

	test("replays history and restores streaming snapshots for the active provider", () => {
		useAgentsStore
			.getState()
			.setAgents([{ agentId: "agent-railly", name: "railly" }]);
		useAgentsStore.getState().setActiveAgent("agent-railly");
		useRuntimeStore.getState().updateFromStatus({
			type: "runtime_status",
			agentName: "railly",
			providerId: "mock",
			model: "opus",
			effort: "medium",
			running: true,
			sessionId: "sdk-active",
		});
		const { options } = createHandlerOptions();

		handleBrowserServerEvent(
			{
				type: "history_replay",
				sdkSessionId: "sdk-active",
				messages: [
					{
						kind: "chat",
						role: "user",
						content: "saved prompt",
					},
					{
						kind: "system",
						event: "compact_boundary",
						text: "context compacted",
						trigger: "auto",
						preTokens: 100_000,
					},
				],
			},
			options,
		);
		handleBrowserServerEvent(
			{
				type: "streaming_sync",
				sdkSessionId: "sdk-active",
				text: "partial",
				thinking: "plan",
				images: [
					{
						kind: "managed",
						path: "/tmp/a.png",
						mediaType: "image/png",
					},
				],
			},
			options,
		);

		const session = useChatStore
			.getState()
			.getSession("agent-railly:mock:sdk-active");
		expect(session?.messages).toEqual([
			{
				kind: "chat",
				role: "user",
				content: "saved prompt",
			},
			{
				kind: "system",
				event: "compact_boundary",
				text: "context compacted",
				trigger: "auto",
				preTokens: 100_000,
			},
		]);
		expect(session).toMatchObject({
			streamingText: "partial",
			streamingThinking: "plan",
			isStreaming: true,
			isThinking: true,
		});
		expect(session?.streamingImages).toHaveLength(1);
	});

	test("adopts pending chat content when runtime status binds a new running session", () => {
		setSystemTime(new Date("2026-04-27T00:00:00.000Z"));
		useAgentsStore
			.getState()
			.setAgents([{ agentId: "agent-railly", name: "railly" }]);
		useAgentsStore.getState().setActiveAgent("agent-railly");
		useRuntimeStore.getState().updateFromStatus({
			type: "runtime_status",
			agentName: "railly",
			providerId: "mock",
			model: "opus",
			effort: "medium",
			running: true,
		});
		const pendingSessionKey = "agent-railly:mock:__pending__";
		const finalSessionKey = "agent-railly:mock:sdk-auto-main";
		useChatStore.getState().pushMessage(pendingSessionKey, {
			kind: "chat",
			role: "user",
			content: "new task",
			timestamp: Date.parse("2026-04-27T00:00:00.000Z"),
		});
		useChatStore.getState().startAssistantTurn(pendingSessionKey);
		const { calls, options } = createHandlerOptions({
			bindLiveRunSession: (
				nextSessionKey: string,
				currentSessionKey: string,
			) => {
				calls.push(`live:bind:${currentSessionKey}->${nextSessionKey}`);
				return {
					adoptFromSessionKey: currentSessionKey,
					sessionKey: nextSessionKey,
				};
			},
			getCurrentSessionKey: () => pendingSessionKey,
		});

		handleBrowserServerEvent(
			{
				type: "runtime_status",
				agentName: "railly",
				providerId: "mock",
				model: "opus",
				effort: "medium",
				running: true,
				sessionId: "sdk-auto-main",
				sessionTitle: "Generated title",
			},
			options,
		);

		expect(
			useChatStore.getState().getSession(pendingSessionKey),
		).toBeUndefined();
		expect(useChatStore.getState().getSession(finalSessionKey)).toMatchObject({
			messages: [
				{
					kind: "chat",
					role: "user",
					content: "new task",
					timestamp: Date.parse("2026-04-27T00:00:00.000Z"),
				},
			],
			isStreaming: true,
			isThinking: true,
		});
		expect(
			useSessionsStore.getState().activeSessionByAgent["agent-railly"],
		).toEqual(createBrowserSessionRef("agent-railly", "mock", "sdk-auto-main"));
		expect(useRuntimeStore.getState()).toMatchObject({
			running: true,
			sessionId: "sdk-auto-main",
			sessionTitle: "Generated title",
		});
		expect(calls).toEqual([
			"live:bind:agent-railly:mock:__pending__->agent-railly:mock:sdk-auto-main",
		]);
	});

	test("keeps a bound running chat when a later status omits the session id", () => {
		setSystemTime(new Date("2026-04-27T00:00:00.000Z"));
		useAgentsStore
			.getState()
			.setAgents([{ agentId: "agent-railly", name: "railly" }]);
		useAgentsStore.getState().setActiveAgent("agent-railly");
		useRuntimeStore.getState().updateFromStatus({
			type: "runtime_status",
			agentName: "railly",
			providerId: "mock",
			model: "opus",
			effort: "medium",
			running: true,
		});
		const pendingSessionKey = "agent-railly:mock:__pending__";
		const finalSessionKey = "agent-railly:mock:sdk-auto-main";
		useChatStore.getState().pushMessage(pendingSessionKey, {
			kind: "chat",
			role: "user",
			content: "new task",
			timestamp: Date.parse("2026-04-27T00:00:00.000Z"),
		});
		useChatStore.getState().startAssistantTurn(pendingSessionKey);
		const { options } = createHandlerOptions({
			bindLiveRunSession: (
				nextSessionKey: string,
				currentSessionKey: string,
			) => ({
				adoptFromSessionKey: currentSessionKey,
				sessionKey: nextSessionKey,
			}),
			getCurrentSessionKey: () => pendingSessionKey,
		});

		handleBrowserServerEvent(
			{
				type: "runtime_status",
				agentName: "railly",
				providerId: "mock",
				model: "opus",
				effort: "medium",
				running: true,
				sessionId: "sdk-auto-main",
				sessionTitle: "Generated title",
			},
			options,
		);
		handleBrowserServerEvent(
			{
				type: "runtime_status",
				agentName: "railly",
				providerId: "mock",
				model: "opus",
				effort: "medium",
				running: true,
			},
			options,
		);

		expect(useChatStore.getState().getSession(finalSessionKey)).toMatchObject({
			messages: [
				{
					kind: "chat",
					role: "user",
					content: "new task",
					timestamp: Date.parse("2026-04-27T00:00:00.000Z"),
				},
			],
			isStreaming: true,
			isThinking: true,
		});
		expect(
			useChatStore.getState().getSession(pendingSessionKey),
		).toBeUndefined();
		expect(
			useSessionsStore.getState().activeSessionByAgent["agent-railly"],
		).toEqual(createBrowserSessionRef("agent-railly", "mock", "sdk-auto-main"));
		expect(useRuntimeStore.getState()).toMatchObject({
			running: true,
			sessionId: "sdk-auto-main",
			sessionTitle: "Generated title",
		});
	});

	test("silently applies generated titles without binding pending chat early", () => {
		setSystemTime(new Date("2026-04-27T00:00:00.000Z"));
		useAgentsStore
			.getState()
			.setAgents([{ agentId: "agent-railly", name: "railly" }]);
		useAgentsStore.getState().setActiveAgent("agent-railly");
		useRuntimeStore.getState().updateFromStatus({
			type: "runtime_status",
			agentName: "railly",
			providerId: "mock",
			model: "opus",
			effort: "medium",
			running: true,
		});
		useSessionsStore.getState().setSessions("agent-railly", [
			{
				agentId: "agent-railly",
				providerId: "mock",
				sdkSessionId: "sdk-auto-main",
				title: "Fallback prompt",
				model: "opus",
				lastActive: 1,
			},
		]);
		const pendingSessionKey = "agent-railly:mock:__pending__";
		useChatStore.getState().pushMessage(pendingSessionKey, {
			kind: "chat",
			role: "user",
			content: "Fallback prompt",
			timestamp: Date.parse("2026-04-27T00:00:00.000Z"),
		});
		useChatStore.getState().startAssistantTurn(pendingSessionKey);
		useRuntimePopupStore.getState().openStatus("Keep this popup open");
		const { calls, options } = createHandlerOptions({
			bindLiveRunSession: (
				nextSessionKey: string,
				currentSessionKey: string,
			) => {
				calls.push(`live:bind:${currentSessionKey}->${nextSessionKey}`);
				return {
					adoptFromSessionKey: currentSessionKey,
					sessionKey: nextSessionKey,
				};
			},
			getCurrentSessionKey: () => pendingSessionKey,
		});

		handleBrowserServerEvent(
			{
				type: "session_renamed",
				sdkSessionId: "sdk-auto-main",
				title: "Generated title",
				providerId: "mock",
				active: true,
			},
			options,
		);

		expect(calls).toEqual([]);
		expect(useRuntimePopupStore.getState().popup).toEqual({
			kind: "status",
			text: "Keep this popup open",
		});
		expect(useChatStore.getState().getSession(pendingSessionKey)).toMatchObject(
			{
				messages: [
					{
						kind: "chat",
						role: "user",
						content: "Fallback prompt",
						timestamp: Date.parse("2026-04-27T00:00:00.000Z"),
					},
				],
				isStreaming: true,
				isThinking: true,
			},
		);
		expect(
			useSessionsStore.getState().activeSessionByAgent["agent-railly"],
		).toBeUndefined();
		expect(useSessionsStore.getState().sessionsByAgent["agent-railly"]).toEqual(
			[
				{
					agentId: "agent-railly",
					providerId: "mock",
					sdkSessionId: "sdk-auto-main",
					title: "Generated title",
					model: "opus",
					lastActive: 1,
				},
			],
		);
		expect(useRuntimeStore.getState()).toMatchObject({
			running: true,
			sessionId: null,
			sessionTitle: null,
		});
	});

	test("updates the visible title when a renamed session is already selected", () => {
		useAgentsStore
			.getState()
			.setAgents([{ agentId: "agent-railly", name: "railly" }]);
		useAgentsStore.getState().setActiveAgent("agent-railly");
		useRuntimeStore.getState().updateFromStatus({
			type: "runtime_status",
			agentName: "railly",
			providerId: "mock",
			model: "opus",
			effort: "medium",
			running: true,
			sessionId: "sdk-auto-main",
			sessionTitle: "Fallback prompt",
		});
		useSessionsStore.getState().setSessions("agent-railly", [
			{
				agentId: "agent-railly",
				providerId: "mock",
				sdkSessionId: "sdk-auto-main",
				title: "Fallback prompt",
				model: "opus",
				lastActive: 1,
			},
		]);
		useSessionsStore
			.getState()
			.setActiveSession(
				"agent-railly",
				createBrowserSessionRef("agent-railly", "mock", "sdk-auto-main"),
			);
		useRuntimePopupStore.getState().openStatus("Keep this popup open");
		const { calls, options } = createHandlerOptions();

		handleBrowserServerEvent(
			{
				type: "session_renamed",
				sdkSessionId: "sdk-auto-main",
				title: "Generated title",
				providerId: "mock",
				active: true,
			},
			options,
		);

		expect(calls).toEqual([]);
		expect(useRuntimePopupStore.getState().popup).toEqual({
			kind: "status",
			text: "Keep this popup open",
		});
		expect(useRuntimeStore.getState()).toMatchObject({
			sessionId: "sdk-auto-main",
			sessionTitle: "Generated title",
		});
		expect(useSessionsStore.getState().sessionsByAgent["agent-railly"]).toEqual(
			[
				{
					agentId: "agent-railly",
					providerId: "mock",
					sdkSessionId: "sdk-auto-main",
					title: "Generated title",
					model: "opus",
					lastActive: 1,
				},
			],
		);
	});

	test("keeps visible title when another provider renames the same session id", () => {
		useAgentsStore
			.getState()
			.setAgents([{ agentId: "agent-railly", name: "railly" }]);
		useAgentsStore.getState().setActiveAgent("agent-railly");
		useRuntimeStore.getState().updateFromStatus({
			type: "runtime_status",
			agentName: "railly",
			providerId: "mock",
			model: "opus",
			effort: "medium",
			running: true,
			sessionId: "sdk-auto-main",
			sessionTitle: "Mock title",
		});
		useSessionsStore.getState().setSessions("agent-railly", [
			{
				agentId: "agent-railly",
				providerId: "mock",
				sdkSessionId: "sdk-auto-main",
				title: "Mock title",
				model: "opus",
				lastActive: 1,
			},
			{
				agentId: "agent-railly",
				providerId: "other",
				sdkSessionId: "sdk-auto-main",
				title: "Other title",
				model: "sonnet",
				lastActive: 2,
			},
		]);
		useSessionsStore
			.getState()
			.setActiveSession(
				"agent-railly",
				createBrowserSessionRef("agent-railly", "mock", "sdk-auto-main"),
			);
		const { options } = createHandlerOptions();

		handleBrowserServerEvent(
			{
				type: "session_renamed",
				sdkSessionId: "sdk-auto-main",
				title: "Other generated title",
				providerId: "other",
				active: true,
			},
			options,
		);

		expect(useRuntimeStore.getState()).toMatchObject({
			providerId: "mock",
			sessionId: "sdk-auto-main",
			sessionTitle: "Mock title",
		});
		expect(useSessionsStore.getState().sessionsByAgent["agent-railly"]).toEqual(
			[
				{
					agentId: "agent-railly",
					providerId: "mock",
					sdkSessionId: "sdk-auto-main",
					title: "Mock title",
					model: "opus",
					lastActive: 1,
				},
				{
					agentId: "agent-railly",
					providerId: "other",
					sdkSessionId: "sdk-auto-main",
					title: "Other generated title",
					model: "sonnet",
					lastActive: 2,
				},
			],
		);
	});

	test("routes streamed browser events into the observed chat session", () => {
		setSystemTime(new Date("2026-04-27T00:00:00.000Z"));
		useAgentsStore
			.getState()
			.setAgents([{ agentId: "agent-railly", name: "railly" }]);
		useAgentsStore.getState().setActiveAgent("agent-railly");
		useRuntimeStore.getState().updateFromStatus({
			type: "runtime_status",
			agentName: "railly",
			providerId: "mock",
			model: "opus",
			effort: "medium",
			running: true,
			sessionId: "sdk-active",
		});
		const { calls, options } = createHandlerOptions();

		handleBrowserServerEvent(
			{
				type: "user_prompt",
				source: "browser",
				prompt: "hello",
				sessionId: "sdk-active",
			},
			options,
		);
		handleBrowserServerEvent(
			{ type: "thinking", text: "plan", sessionId: "sdk-active" },
			options,
		);
		handleBrowserServerEvent(
			{ type: "text", text: "answer", sessionId: "sdk-active" },
			options,
		);
		handleBrowserServerEvent(
			{ type: "image", path: "/tmp/chart.webp", sessionId: "sdk-active" },
			options,
		);
		handleBrowserServerEvent(
			{ type: "compacting_started", sessionId: "sdk-active" },
			options,
		);
		handleBrowserServerEvent(
			{ type: "compacting_finished", sessionId: "sdk-active" },
			options,
		);
		handleBrowserServerEvent(
			{
				type: "done",
				sessionId: "sdk-active",
				durationMs: 1,
				usage: USAGE,
			},
			options,
		);

		const session = useChatStore
			.getState()
			.getSession("agent-railly:mock:sdk-active");
		expect(session?.messages).toEqual([
			{
				kind: "chat",
				role: "user",
				content: "hello",
				timestamp: Date.parse("2026-04-27T00:00:00.000Z"),
			},
			{
				kind: "system",
				event: "compact_boundary",
				text: "context compacted",
			},
			{
				kind: "chat",
				role: "assistant",
				content: "answer",
				thinking: "plan",
				images: [
					{
						kind: "managed",
						path: "/tmp/chart.webp",
						mediaType: "image/webp",
					},
				],
				timestamp: Date.parse("2026-04-27T00:00:00.000Z"),
				assistantTurn: {
					source: "user",
					startedAt: Date.parse("2026-04-27T00:00:00.000Z"),
					durationMs: 0,
				},
			},
		]);
		expect(session?.isCompacting).toBe(false);
		expect(
			useSessionsStore.getState().activeSessionByAgent["agent-railly"],
		).toEqual(createBrowserSessionRef("agent-railly", "mock", "sdk-active"));
		expect(calls).toEqual([
			"live:complete:agent-railly:mock:sdk-active",
			"sidebar:refresh",
		]);
	});

	test("adds a compact boundary when live compaction finishes", () => {
		useAgentsStore
			.getState()
			.setAgents([{ agentId: "agent-railly", name: "railly" }]);
		useAgentsStore.getState().setActiveAgent("agent-railly");
		useRuntimeStore.getState().updateFromStatus({
			type: "runtime_status",
			agentName: "railly",
			providerId: "mock",
			model: "opus",
			effort: "medium",
			running: true,
			sessionId: "sdk-active",
		});
		const { options } = createHandlerOptions();

		handleBrowserServerEvent(
			{ type: "compacting_started", sessionId: "sdk-active" },
			options,
		);
		handleBrowserServerEvent(
			{ type: "compacting_finished", sessionId: "sdk-active" },
			options,
		);

		const session = useChatStore
			.getState()
			.getSession("agent-railly:mock:sdk-active");
		expect(session?.isCompacting).toBe(false);
		expect(session?.messages).toEqual([
			{
				kind: "system",
				event: "compact_boundary",
				text: "context compacted",
			},
		]);
	});

	test("confirms queued browser prompts when the runtime starts the queued turn", () => {
		setSystemTime(new Date("2026-04-27T00:00:00.000Z"));
		useAgentsStore
			.getState()
			.setAgents([{ agentId: "agent-railly", name: "railly" }]);
		useAgentsStore.getState().setActiveAgent("agent-railly");
		useRuntimeStore.getState().updateFromStatus({
			type: "runtime_status",
			agentName: "railly",
			providerId: "mock",
			model: "opus",
			effort: "medium",
			running: true,
			sessionId: "sdk-active",
		});
		const { options } = createHandlerOptions();
		const sessionKey = "agent-railly:mock:sdk-active";

		useChatStore.getState().pushMessage(sessionKey, {
			kind: "chat",
			role: "user",
			content: "current prompt",
		});
		useChatStore.getState().startAssistantTurn(sessionKey);
		useChatStore.getState().appendText(sessionKey, "current response");
		useChatStore.getState().queuePrompt(sessionKey, {
			kind: "chat",
			role: "user",
			content: "queued follow-up",
		});
		useChatStore.getState().finalizeMessage(sessionKey);

		expect(
			useChatStore.getState().getSession(sessionKey)?.queuedPrompts,
		).toEqual([
			{
				kind: "chat",
				role: "user",
				content: "queued follow-up",
			},
		]);

		handleBrowserServerEvent(
			{
				type: "user_prompt",
				source: "browser",
				prompt: "queued follow-up",
				sessionId: "sdk-active",
			},
			options,
		);

		const session = useChatStore.getState().getSession(sessionKey);
		expect(session?.queuedPrompts).toEqual([]);
		expect(session?.messages.at(-1)).toMatchObject({
			kind: "chat",
			role: "user",
			content: "queued follow-up",
		});
		expect(session?.isStreaming).toBe(true);
		expect(session?.isThinking).toBe(true);
	});

	test("adopts a pending live-run session when completion reports a new sdk session", () => {
		setSystemTime(new Date("2026-04-27T00:00:00.000Z"));
		useAgentsStore
			.getState()
			.setAgents([{ agentId: "agent-railly", name: "railly" }]);
		useAgentsStore.getState().setActiveAgent("agent-railly");
		useRuntimeStore.getState().updateFromStatus({
			type: "runtime_status",
			agentName: "railly",
			providerId: "mock",
			model: "opus",
			effort: "medium",
			running: true,
			sessionId: "sdk-pending",
		});
		useChatStore.getState().pushMessage("agent-railly:mock:sdk-pending", {
			kind: "chat",
			role: "user",
			content: "new task",
		});
		useChatStore.getState().appendText("agent-railly:mock:sdk-pending", "done");
		const { calls, options } = createHandlerOptions({
			completeLiveRunSession: (
				nextSessionKey: string,
				currentSessionKey: string,
			) => {
				calls.push(`live:complete:${currentSessionKey}->${nextSessionKey}`);
				return {
					adoptFromSessionKey: currentSessionKey,
					sessionKey: nextSessionKey,
				};
			},
			getCurrentSessionKey: () => "agent-railly:mock:sdk-pending",
		});

		handleBrowserServerEvent(
			{ type: "done", sessionId: "sdk-final", durationMs: 1, usage: USAGE },
			options,
		);

		expect(
			useChatStore.getState().getSession("agent-railly:mock:sdk-pending"),
		).toBeUndefined();
		expect(
			useChatStore.getState().getSession("agent-railly:mock:sdk-final")
				?.messages,
		).toEqual([
			{
				kind: "chat",
				role: "user",
				content: "new task",
			},
			{
				kind: "chat",
				role: "assistant",
				content: "done",
				timestamp: Date.parse("2026-04-27T00:00:00.000Z"),
			},
		]);
		expect(
			useSessionsStore.getState().activeSessionByAgent["agent-railly"],
		).toEqual(createBrowserSessionRef("agent-railly", "mock", "sdk-final"));
		expect(
			useContextUsageStore.getState().getUsage("agent-railly:mock:sdk-final"),
		).toEqual(USAGE);
		expect(calls).toEqual([
			"live:complete:agent-railly:mock:sdk-pending->agent-railly:mock:sdk-final",
			"sidebar:refresh",
		]);
	});

	test("adopts pending live-run content into the final provider session with turn duration", () => {
		const promptTime = new Date("2026-04-27T00:00:00.000Z");
		const doneTime = new Date("2026-04-27T00:00:42.000Z");
		setSystemTime(promptTime);
		useAgentsStore
			.getState()
			.setAgents([{ agentId: "agent-railly", name: "railly" }]);
		useAgentsStore.getState().setActiveAgent("agent-railly");
		useRuntimeStore.getState().updateFromStatus({
			type: "runtime_status",
			agentName: "railly",
			providerId: "mock",
			model: "opus",
			effort: "medium",
			running: true,
		});
		const pendingSessionKey = "agent-railly:mock:__pending__";
		const finalSessionKey = "agent-railly:mock:sdk-final";
		const { options } = createHandlerOptions({
			completeLiveRunSession: (
				nextSessionKey: string,
				currentSessionKey: string,
			) => ({
				adoptFromSessionKey: currentSessionKey,
				sessionKey: nextSessionKey,
			}),
			getCurrentSessionKey: () => pendingSessionKey,
			pinObservedSessionKey: () => pendingSessionKey,
			routeObservedSessionKey: () => pendingSessionKey,
		});

		handleBrowserServerEvent(
			{
				type: "user_prompt",
				source: "browser",
				prompt: "new task",
			},
			options,
		);
		handleBrowserServerEvent(
			{ type: "thinking", text: "plan", sessionId: "__pending__" },
			options,
		);
		handleBrowserServerEvent(
			{ type: "text", text: "done", sessionId: "__pending__" },
			options,
		);
		handleBrowserServerEvent(
			{
				type: "image",
				path: "/tmp/result.png",
				mediaType: "image/png",
				sessionId: "__pending__",
			},
			options,
		);

		setSystemTime(doneTime);
		handleBrowserServerEvent(
			{ type: "done", sessionId: "sdk-final", durationMs: 42_000 },
			options,
		);

		expect(
			useChatStore.getState().getSession(pendingSessionKey),
		).toBeUndefined();
		expect(useChatStore.getState().getMessages(finalSessionKey)).toEqual([
			{
				kind: "chat",
				role: "user",
				content: "new task",
				timestamp: promptTime.getTime(),
			},
			{
				kind: "chat",
				role: "assistant",
				content: "done",
				thinking: "plan",
				images: [
					{
						kind: "managed",
						path: "/tmp/result.png",
						mediaType: "image/png",
					},
				],
				timestamp: doneTime.getTime(),
				assistantTurn: {
					source: "user",
					startedAt: promptTime.getTime(),
					durationMs: doneTime.getTime() - promptTime.getTime(),
				},
			},
		]);
		expect(
			useSessionsStore.getState().activeSessionByAgent["agent-railly"],
		).toEqual(createBrowserSessionRef("agent-railly", "mock", "sdk-final"));
	});

	test("handles menus, session mutations, errors, skills, and sidebar invalidations", () => {
		useAgentsStore
			.getState()
			.setAgents([{ agentId: "agent-railly", name: "railly" }]);
		useAgentsStore.getState().setActiveAgent("agent-railly");
		useRuntimeStore.getState().updateFromStatus({
			type: "runtime_status",
			agentName: "railly",
			providerId: "mock",
			model: "opus",
			effort: "medium",
			running: false,
			sessionId: "sdk-active",
		});
		useSessionsStore.getState().setSessions("agent-railly", [
			{
				agentId: "agent-railly",
				providerId: "mock",
				sdkSessionId: "sdk-active",
				title: "Active",
				model: "opus",
				lastActive: 100,
			},
		]);
		const { calls, options } = createHandlerOptions();

		handleBrowserServerEvent(
			{
				type: "agent_menu",
				activeAgentId: "agent-railly",
				activeAgentName: "railly",
				agents: [{ agentId: "agent-railly", name: "railly" }],
			},
			options,
		);
		expect(useRuntimePopupStore.getState().popup).toMatchObject({
			kind: "agent",
		});

		handleBrowserServerEvent(
			{
				type: "session_menu",
				activeSessionId: "sdk-active",
				sessions: [
					{
						sdkSessionId: "sdk-active",
						title: "Active",
						model: "opus",
						lastActive: 100,
					},
				],
			},
			options,
		);
		expect(useRuntimePopupStore.getState().popup).toMatchObject({
			kind: "session",
		});

		handleBrowserServerEvent(
			{ type: "session_deleted", sdkSessionId: "sdk-active" },
			options,
		);
		expect(useSessionsStore.getState().sessionsByAgent["agent-railly"]).toEqual(
			[],
		);
		expect(calls).toContain("sidebar:refresh");

		handleBrowserServerEvent(
			{
				type: "skills_update",
				skills: [{ name: "/test", description: "Test" }],
			},
			options,
		);
		expect(useSlashCommandsStore.getState().skills).toEqual([
			{ name: "/test", description: "Test" },
		]);

		useAgentFilesStore.setState({
			entriesByAgent: {
				"agent-railly": {
					files: [{ kind: "file", path: "stale.md" }],
					loadedAt: 1,
				},
			},
			loadingAgentId: null,
		});
		handleBrowserServerEvent(
			{
				type: "browser_sidebar_invalidated",
				agentId: "agent-railly",
				sections: ["tree", "cron", "git"],
			},
			options,
		);
		expect(useRightPanelRefreshStore.getState()).toMatchObject({
			cronRevisionByAgent: { "agent-railly": 1 },
			gitRevision: 1,
			treeRevisionByAgent: { "agent-railly": 1 },
		});
		expect(
			useAgentFilesStore.getState().entriesByAgent["agent-railly"],
		).toBeUndefined();

		handleBrowserServerEvent(
			{ type: "error", message: "provider failed", sessionId: "sdk-active" },
			options,
		);
		expect(useRuntimeStore.getState().error).toBe("provider failed");
		expect(calls).toContain("live:clear");
	});

	test("handles status, model, effort, and ignored terminal-only events", () => {
		setSystemTime(new Date("2026-04-27T00:00:00.000Z"));
		useAgentsStore
			.getState()
			.setAgents([{ agentId: "agent-railly", name: "railly" }]);
		useAgentsStore.getState().setActiveAgent("agent-railly");
		const { options } = createHandlerOptions();

		handleBrowserServerEvent(
			{ type: "model_changed", model: "sonnet" },
			options,
		);
		handleBrowserServerEvent(
			{ type: "effort_changed", effort: "high" },
			options,
		);
		handleBrowserServerEvent(
			{
				type: "status",
				message: "Working",
				presentation: "inline",
			},
			options,
		);
		handleBrowserServerEvent(
			{
				type: "session_info",
				sdkSessionId: "sdk-a",
				title: "Alpha",
				model: "opus",
			},
			options,
		);
		handleBrowserServerEvent(
			{
				type: "cron_result",
				jobName: "daily",
				providerId: "mock",
				text: "ok",
				sessionId: "cron-session-1",
				ranAt: 0,
			},
			options,
		);
		handleBrowserServerEvent({ type: "ask_response", text: "ok" }, options);
		handleBrowserServerEvent({ type: "ask_error", message: "nope" }, options);
		handleBrowserServerEvent({ type: "send_response" }, options);
		handleBrowserServerEvent({ type: "send_error", message: "nope" }, options);

		expect(useRuntimeStore.getState()).toMatchObject({
			model: "sonnet",
			effort: "high",
		});
		expect(
			useChatStore.getState().getMessages("agent-railly:mock:sdk-active"),
		).toEqual([
			{
				kind: "system",
				event: "status",
				text: "Working",
				timestamp: Date.parse("2026-04-27T00:00:00.000Z"),
			},
		]);
		expect(useRuntimePopupStore.getState().popup).toEqual({
			kind: "status",
			text: "Session\nAlpha\nmodel: opus\nid: sdk-a",
		});
	});
});
