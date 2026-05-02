import { describe, expect, test } from "bun:test";
import type { BrowserAgentsResponse } from "../../../src/common/protocol.ts";
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
		const coordinator = createSidebarRefreshCoordinator({
			applySidebarSummary: (summary) => {
				calls.push(`summary:${summary.activeAgentId}`);
			},
			fetchSidebarSummary: () => responses.shift() ?? Promise.reject(),
			gate,
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
			gate,
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
});
