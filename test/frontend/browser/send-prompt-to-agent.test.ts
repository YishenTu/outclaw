import { describe, expect, test } from "bun:test";
import {
	sendBrowserPromptToAgent,
	sendPromptToAgent,
} from "../../../src/frontend/browser/prompts/send-prompt-to-agent.ts";

describe("sendPromptToAgent", () => {
	test("sends a trimmed prompt without switching when the target agent is already active", () => {
		const calls: string[] = [];

		const sent = sendPromptToAgent({
			agent: { agentId: "agent-alpha", name: "alpha" },
			activeAgentId: "agent-alpha",
			runtimeAgentName: "alpha",
			clearRuntimeSession: () => calls.push("clear"),
			prompt: "  hello world  ",
			sendCommand: (command) => {
				calls.push(`command:${command}`);
				return true;
			},
			sendPrompt: (prompt) => {
				calls.push(`prompt:${prompt}`);
				return true;
			},
			setActiveAgent: (agentId) => calls.push(`active:${agentId}`),
			setAgentName: (name) => calls.push(`name:${name}`),
		});

		expect(sent).toBe(true);
		expect(calls).toEqual(["prompt:hello world"]);
	});

	test("switches agents optimistically before sending the prompt", () => {
		const calls: string[] = [];

		const sent = sendPromptToAgent({
			agent: { agentId: "agent-beta", name: "beta" },
			activeAgentId: "agent-alpha",
			runtimeAgentName: "alpha",
			clearRuntimeSession: () => calls.push("clear"),
			prompt: "hello beta",
			sendCommand: (command) => {
				calls.push(`command:${command}`);
				return true;
			},
			sendPrompt: (prompt) => {
				calls.push(`prompt:${prompt}`);
				return true;
			},
			setActiveAgent: (agentId) => calls.push(`active:${agentId}`),
			setAgentName: (name) => calls.push(`name:${name}`),
		});

		expect(sent).toBe(true);
		expect(calls).toEqual([
			"command:/agent beta",
			"active:agent-beta",
			"name:beta",
			"clear",
			"prompt:hello beta",
		]);
	});

	test("switches when runtime is on a different agent even if activeAgentId already matches the target", () => {
		const calls: string[] = [];

		const sent = sendPromptToAgent({
			agent: { agentId: "agent-beta", name: "beta" },
			activeAgentId: "agent-beta",
			runtimeAgentName: "alpha",
			clearRuntimeSession: () => calls.push("clear"),
			prompt: "hello beta",
			sendCommand: (command) => {
				calls.push(`command:${command}`);
				return true;
			},
			sendPrompt: (prompt) => {
				calls.push(`prompt:${prompt}`);
				return true;
			},
			setActiveAgent: (agentId) => calls.push(`active:${agentId}`),
			setAgentName: (name) => calls.push(`name:${name}`),
		});

		expect(sent).toBe(true);
		expect(calls).toEqual([
			"command:/agent beta",
			"active:agent-beta",
			"name:beta",
			"clear",
			"prompt:hello beta",
		]);
	});

	test("does not send the prompt when switching agents fails", () => {
		const calls: string[] = [];

		const sent = sendPromptToAgent({
			agent: { agentId: "agent-beta", name: "beta" },
			activeAgentId: "agent-alpha",
			runtimeAgentName: "alpha",
			clearRuntimeSession: () => calls.push("clear"),
			prompt: "hello beta",
			sendCommand: (command) => {
				calls.push(`command:${command}`);
				return false;
			},
			sendPrompt: (prompt) => {
				calls.push(`prompt:${prompt}`);
				return true;
			},
			setActiveAgent: (agentId) => calls.push(`active:${agentId}`),
			setAgentName: (name) => calls.push(`name:${name}`),
		});

		expect(sent).toBe(false);
		expect(calls).toEqual(["command:/agent beta"]);
	});
});

describe("sendBrowserPromptToAgent", () => {
	function createAttachment() {
		return {
			id: "img-1",
			file: new File(["abc"], "cat.png", { type: "image/png" }),
			image: {
				kind: "inline" as const,
				base64: "YWJj",
				mediaType: "image/png" as const,
			},
		};
	}

	test("sends an image-only browser prompt without switching when the target agent is already active", async () => {
		const calls: string[] = [];
		const image = createAttachment();

		const sent = await sendBrowserPromptToAgent({
			agent: { agentId: "agent-alpha", name: "alpha" },
			activeAgentId: "agent-alpha",
			runtimeAgentName: "alpha",
			clearRuntimeSession: () => calls.push("clear"),
			prompt: "   ",
			images: [image],
			sendCommand: (command) => {
				calls.push(`command:${command}`);
				return true;
			},
			sendBrowserPrompt: async (prompt, images) => {
				calls.push(`browser:${prompt}:${images.length}`);
				return true;
			},
			setActiveAgent: (agentId) => calls.push(`active:${agentId}`),
			setAgentName: (name) => calls.push(`name:${name}`),
		});

		expect(sent).toBe(true);
		expect(calls).toEqual(["browser::1"]);
	});

	test("switches agents optimistically before sending a browser prompt", async () => {
		const calls: string[] = [];

		const sent = await sendBrowserPromptToAgent({
			agent: { agentId: "agent-beta", name: "beta" },
			activeAgentId: "agent-alpha",
			runtimeAgentName: "alpha",
			clearRuntimeSession: () => calls.push("clear"),
			prompt: "hello beta",
			images: [createAttachment()],
			sendCommand: (command) => {
				calls.push(`command:${command}`);
				return true;
			},
			sendBrowserPrompt: async (prompt, images) => {
				calls.push(`browser:${prompt}:${images.length}`);
				return true;
			},
			setActiveAgent: (agentId) => calls.push(`active:${agentId}`),
			setAgentName: (name) => calls.push(`name:${name}`),
		});

		expect(sent).toBe(true);
		expect(calls).toEqual([
			"command:/agent beta",
			"active:agent-beta",
			"name:beta",
			"clear",
			"browser:hello beta:1",
		]);
	});

	test("activates the selected saved session before sending a browser prompt", async () => {
		const calls: string[] = [];

		const sent = await sendBrowserPromptToAgent({
			agent: { agentId: "agent-alpha", name: "alpha" },
			activeAgentId: "agent-alpha",
			runtimeAgentName: "alpha",
			clearRuntimeSession: () => calls.push("clear"),
			prompt: "hello again",
			images: [createAttachment()],
			targetSession: {
				agentId: "agent-alpha",
				providerId: "claude",
				sdkSessionId: "sdk-existing",
			},
			runtimeProviderId: "claude",
			runtimeSessionId: "sdk-other",
			sendCommand: (command) => {
				calls.push(`command:${command}`);
				return true;
			},
			sendBrowserPrompt: async (prompt, images) => {
				calls.push(`browser:${prompt}:${images.length}`);
				return true;
			},
			setActiveAgent: (agentId) => calls.push(`active:${agentId}`),
			setAgentName: (name) => calls.push(`name:${name}`),
		});

		expect(sent).toBe(true);
		expect(calls).toEqual([
			"command:/session sdk-existing",
			"browser:hello again:1",
		]);
	});

	test("switches agents and activates the selected session before sending a browser prompt", async () => {
		const calls: string[] = [];

		const sent = await sendBrowserPromptToAgent({
			agent: { agentId: "agent-beta", name: "beta" },
			activeAgentId: "agent-alpha",
			runtimeAgentName: "alpha",
			clearRuntimeSession: () => calls.push("clear"),
			prompt: "hello beta",
			images: [createAttachment()],
			targetSession: {
				agentId: "agent-beta",
				providerId: "claude",
				sdkSessionId: "sdk-existing",
			},
			runtimeProviderId: "claude",
			runtimeSessionId: "sdk-other",
			sendCommand: (command) => {
				calls.push(`command:${command}`);
				return true;
			},
			sendBrowserPrompt: async (prompt, images) => {
				calls.push(`browser:${prompt}:${images.length}`);
				return true;
			},
			setActiveAgent: (agentId) => calls.push(`active:${agentId}`),
			setAgentName: (name) => calls.push(`name:${name}`),
		});

		expect(sent).toBe(true);
		expect(calls).toEqual([
			"command:/agent beta",
			"active:agent-beta",
			"name:beta",
			"clear",
			"command:/session sdk-existing",
			"browser:hello beta:1",
		]);
	});

	test("switches when runtime is on a different agent even if activeAgentId already matches the target", async () => {
		const calls: string[] = [];

		const sent = await sendBrowserPromptToAgent({
			agent: { agentId: "agent-beta", name: "beta" },
			activeAgentId: "agent-beta",
			runtimeAgentName: "alpha",
			clearRuntimeSession: () => calls.push("clear"),
			prompt: "hello beta",
			images: [createAttachment()],
			sendCommand: (command) => {
				calls.push(`command:${command}`);
				return true;
			},
			sendBrowserPrompt: async (prompt, images) => {
				calls.push(`browser:${prompt}:${images.length}`);
				return true;
			},
			setActiveAgent: (agentId) => calls.push(`active:${agentId}`),
			setAgentName: (name) => calls.push(`name:${name}`),
		});

		expect(sent).toBe(true);
		expect(calls).toEqual([
			"command:/agent beta",
			"active:agent-beta",
			"name:beta",
			"clear",
			"browser:hello beta:1",
		]);
	});

	test("does not send the browser prompt when switching agents fails", async () => {
		const calls: string[] = [];

		const sent = await sendBrowserPromptToAgent({
			agent: { agentId: "agent-beta", name: "beta" },
			activeAgentId: "agent-alpha",
			runtimeAgentName: "alpha",
			clearRuntimeSession: () => calls.push("clear"),
			prompt: "",
			images: [createAttachment()],
			sendCommand: (command) => {
				calls.push(`command:${command}`);
				return false;
			},
			sendBrowserPrompt: async (prompt, images) => {
				calls.push(`browser:${prompt}:${images.length}`);
				return true;
			},
			setActiveAgent: (agentId) => calls.push(`active:${agentId}`),
			setAgentName: (name) => calls.push(`name:${name}`),
		});

		expect(sent).toBe(false);
		expect(calls).toEqual(["command:/agent beta"]);
	});

	test("does not send the browser prompt when activating the selected session fails", async () => {
		const calls: string[] = [];

		const sent = await sendBrowserPromptToAgent({
			agent: { agentId: "agent-alpha", name: "alpha" },
			activeAgentId: "agent-alpha",
			runtimeAgentName: "alpha",
			clearRuntimeSession: () => calls.push("clear"),
			prompt: "hello again",
			images: [createAttachment()],
			targetSession: {
				agentId: "agent-alpha",
				providerId: "claude",
				sdkSessionId: "sdk-existing",
			},
			runtimeProviderId: "claude",
			runtimeSessionId: "sdk-other",
			sendCommand: (command) => {
				calls.push(`command:${command}`);
				return command !== "/session sdk-existing";
			},
			sendBrowserPrompt: async (prompt, images) => {
				calls.push(`browser:${prompt}:${images.length}`);
				return true;
			},
			setActiveAgent: (agentId) => calls.push(`active:${agentId}`),
			setAgentName: (name) => calls.push(`name:${name}`),
		});

		expect(sent).toBe(false);
		expect(calls).toEqual(["command:/session sdk-existing"]);
	});
});
