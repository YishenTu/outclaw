import { describe, expect, test } from "bun:test";
import type {
	BrowserAgentsResponse,
	BrowserSessionPageResponse,
} from "../../../src/common/protocol.ts";
import { createSidebarRefreshCoordinator } from "../../../src/frontend/browser/sidebar/sidebar-refresh.ts";
import { createSidebarRefreshGate } from "../../../src/frontend/browser/sidebar/sidebar-refresh-gate.ts";

describe("sidebar refresh gate", () => {
	test("accepts only the latest started request", () => {
		const gate = createSidebarRefreshGate();

		const firstRequest = gate.startRequest();
		const secondRequest = gate.startRequest();

		expect(gate.isCurrent(firstRequest)).toBe(false);
		expect(gate.isCurrent(secondRequest)).toBe(true);
	});

	test("invalidating the gate retires in-flight requests", () => {
		const gate = createSidebarRefreshGate();

		const request = gate.startRequest();
		gate.invalidate();

		expect(gate.isCurrent(request)).toBe(false);
	});

	test("refresh coordinator ignores stale summaries and requests skills when connected", async () => {
		const gate = createSidebarRefreshGate();
		const calls: string[] = [];
		const socket = { open: true };
		let resolveFirst: ((summary: BrowserAgentsResponse) => void) | undefined;
		let resolveSecond: ((summary: BrowserAgentsResponse) => void) | undefined;
		const first = new Promise<BrowserAgentsResponse>((resolve) => {
			resolveFirst = resolve;
		});
		const second = new Promise<BrowserAgentsResponse>((resolve) => {
			resolveSecond = resolve;
		});
		const responses = [first, second];
		const coordinator = createSidebarRefreshCoordinator<{ open: boolean }>({
			applySidebarSummary: (summary) => {
				calls.push(`summary:${summary.activeAgentId}`);
			},
			fetchSidebarSummary: () => responses.shift() ?? Promise.reject(),
			applyAgentSessionPage: (agentId) => {
				calls.push(`agent:${agentId}`);
			},
			fetchAgentSessionPage: () => Promise.reject(),
			gate,
			getLoadedAgentSessionCount: () => 0,
			getSocket: () => socket,
			isSocketOpen: (candidate): candidate is typeof socket =>
				candidate === socket,
			sendRequestSkills: () => {
				calls.push("skills");
			},
			setRuntimeError: (error) => {
				calls.push(`error:${error}`);
			},
		});

		coordinator.refresh();
		coordinator.refresh();
		resolveFirst?.({ activeAgentId: "stale", agents: [] });
		resolveSecond?.({ activeAgentId: "current", agents: [] });
		await Promise.all([first, second]);

		expect(calls).toEqual(["skills", "skills", "summary:current"]);
	});

	test("refresh coordinator reports only current fetch failures", async () => {
		const gate = createSidebarRefreshGate();
		const calls: string[] = [];
		type TestSocket = { id: string };
		let rejectFirst: ((error: Error) => void) | undefined;
		let resolveSecond: ((summary: BrowserAgentsResponse) => void) | undefined;
		const first = new Promise<BrowserAgentsResponse>((_, reject) => {
			rejectFirst = reject;
		});
		const second = new Promise<BrowserAgentsResponse>((resolve) => {
			resolveSecond = resolve;
		});
		const responses = [first, second];
		const coordinator = createSidebarRefreshCoordinator<TestSocket>({
			applySidebarSummary: (summary) => {
				calls.push(`summary:${summary.activeAgentId}`);
			},
			fetchSidebarSummary: () => responses.shift() ?? Promise.reject(),
			applyAgentSessionPage: (agentId) => {
				calls.push(`agent:${agentId}`);
			},
			fetchAgentSessionPage: () => Promise.reject(),
			gate,
			getLoadedAgentSessionCount: () => 0,
			getSocket: () => null,
			isSocketOpen: (socket): socket is TestSocket => socket !== null,
			sendRequestSkills: () => {},
			setRuntimeError: (error) => {
				calls.push(`error:${error}`);
			},
		});

		coordinator.refresh();
		coordinator.refresh();
		rejectFirst?.(new Error("stale failed"));
		resolveSecond?.({ activeAgentId: "current", agents: [] });
		await Promise.allSettled([first, second]);

		expect(calls).toEqual(["summary:current"]);
	});

	test("refresh coordinator refreshes one agent session list without requesting skills", async () => {
		const gate = createSidebarRefreshGate();
		const calls: string[] = [];
		const requests: Array<{ agentId: string; limit: number }> = [];
		const response: BrowserSessionPageResponse = {
			sessions: [
				{
					providerId: "mock",
					sdkSessionId: "sdk-1",
					title: "One",
					model: "opus",
					lastActive: 1,
				},
			],
		};
		const coordinator = createSidebarRefreshCoordinator<{ open: boolean }>({
			applySidebarSummary: (summary) => {
				calls.push(`summary:${summary.activeAgentId}`);
			},
			fetchSidebarSummary: () => Promise.reject(),
			applyAgentSessionPage: (agentId, page) => {
				calls.push(`agent:${agentId}:${page.sessions.length}`);
			},
			fetchAgentSessionPage: async (agentId, params) => {
				requests.push({ agentId, limit: params.limit });
				return response;
			},
			gate,
			getLoadedAgentSessionCount: () => 24,
			getSocket: () => ({ open: true }),
			isSocketOpen: (socket): socket is { open: boolean } => socket !== null,
			sendRequestSkills: () => {
				calls.push("skills");
			},
			setRuntimeError: (error) => {
				calls.push(`error:${error}`);
			},
		});

		coordinator.refreshAgentSessions("agent-a");
		await Promise.resolve();

		expect(requests).toEqual([{ agentId: "agent-a", limit: 24 }]);
		expect(calls).toEqual(["agent:agent-a:1"]);
	});

	test("refresh coordinator ignores stale agent session pages", async () => {
		const gate = createSidebarRefreshGate();
		const calls: string[] = [];
		let resolveFirst:
			| ((summary: BrowserSessionPageResponse) => void)
			| undefined;
		let resolveSecond:
			| ((summary: BrowserSessionPageResponse) => void)
			| undefined;
		const first = new Promise<BrowserSessionPageResponse>((resolve) => {
			resolveFirst = resolve;
		});
		const second = new Promise<BrowserSessionPageResponse>((resolve) => {
			resolveSecond = resolve;
		});
		const responses = [first, second];
		const coordinator = createSidebarRefreshCoordinator<{ open: boolean }>({
			applySidebarSummary: () => {
				calls.push("summary");
			},
			fetchSidebarSummary: () => Promise.reject(),
			applyAgentSessionPage: (agentId, page) => {
				calls.push(`${agentId}:${page.sessions[0]?.sdkSessionId}`);
			},
			fetchAgentSessionPage: () => responses.shift() ?? Promise.reject(),
			gate,
			getLoadedAgentSessionCount: () => 10,
			getSocket: () => null,
			isSocketOpen: (socket): socket is { open: boolean } => socket !== null,
			sendRequestSkills: () => {},
			setRuntimeError: (error) => {
				calls.push(`error:${error}`);
			},
		});

		coordinator.refreshAgentSessions("agent-a");
		coordinator.refreshAgentSessions("agent-a");
		resolveFirst?.({
			sessions: [
				{
					providerId: "mock",
					sdkSessionId: "stale",
					title: "Stale",
					model: "opus",
					lastActive: 1,
				},
			],
		});
		resolveSecond?.({
			sessions: [
				{
					providerId: "mock",
					sdkSessionId: "current",
					title: "Current",
					model: "opus",
					lastActive: 2,
				},
			],
		});
		await Promise.all([first, second]);

		expect(calls).toEqual(["agent-a:current"]);
	});
});
