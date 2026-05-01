import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import type { UsageInfo } from "../../../src/common/protocol.ts";
import {
	applySidebarSummary,
	formatSessionInfoSummary,
	formatSessionListSummary,
	handleBrowserServerEvent,
	inferImageMediaTypeFromPath,
} from "../../../src/frontend/browser/events/runtime-server-events.ts";
import { createBrowserSessionRef } from "../../../src/frontend/browser/session.ts";
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
		expect(useRuntimePopupStore.getState().popup).toBeNull();
		expect(calls.filter((call) => call === "sidebar:refresh").length).toBe(3);
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
		]);
		expect(session).toMatchObject({
			streamingText: "partial",
			streamingThinking: "plan",
			isStreaming: true,
			isThinking: true,
		});
		expect(session?.streamingImages).toHaveLength(1);
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
			{ type: "cron_result", jobName: "daily", text: "ok" },
			options,
		);
		handleBrowserServerEvent({ type: "ask_response", text: "ok" }, options);
		handleBrowserServerEvent({ type: "ask_error", message: "nope" }, options);

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
