import { describe, expect, test } from "bun:test";
import { createBrowserSwitchDispatcher } from "../../../src/frontend/browser/commands/browser-switch-dispatcher.ts";
import type { SessionEntry } from "../../../src/frontend/browser/stores/sessions.ts";

const SESSION: SessionEntry = {
	agentId: "agent-beta",
	providerId: "claude",
	sdkSessionId: "sdk-beta",
	title: "Beta",
	model: "sonnet",
	lastActive: 1,
};

describe("browser switch dispatcher", () => {
	test("switches agents through the runtime command path", () => {
		const calls: string[] = [];
		const dispatcher = createBrowserSwitchDispatcher({
			getRuntimeAgentName: () => "alpha",
			sendCommand: (command) => {
				calls.push(command);
				return true;
			},
		});

		expect(dispatcher.switchAgent("beta")).toBe(true);
		expect(calls).toEqual(["/agent beta"]);
	});

	test("switches agent before switching session when runtime is on another agent", () => {
		const calls: string[] = [];
		const dispatcher = createBrowserSwitchDispatcher({
			getRuntimeAgentName: () => "alpha",
			sendCommand: (command) => {
				calls.push(command);
				return true;
			},
		});

		expect(dispatcher.switchSession("beta", SESSION)).toBe(true);
		expect(calls).toEqual(["/agent beta", "/session sdk-beta"]);
	});

	test("does not switch session when the agent switch fails", () => {
		const calls: string[] = [];
		const dispatcher = createBrowserSwitchDispatcher({
			getRuntimeAgentName: () => "alpha",
			sendCommand: (command) => {
				calls.push(command);
				return false;
			},
		});

		expect(dispatcher.switchSession("beta", SESSION)).toBe(false);
		expect(calls).toEqual(["/agent beta"]);
	});

	test("switches only the session when runtime is already on the target agent", () => {
		const calls: string[] = [];
		const dispatcher = createBrowserSwitchDispatcher({
			getRuntimeAgentName: () => "beta",
			sendCommand: (command) => {
				calls.push(command);
				return true;
			},
		});

		expect(dispatcher.switchSession("beta", SESSION)).toBe(true);
		expect(calls).toEqual(["/session sdk-beta"]);
	});
});
