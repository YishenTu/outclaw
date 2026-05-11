import { describe, expect, test } from "bun:test";
import type { PromptExecution } from "../../../src/runtime/application/prompt-execution/prompt-dispatcher.ts";
import { createCodingRuntime } from "../../../src/runtime/coding/index.ts";

describe("CodingRuntime", () => {
	test("runs code prompts as detached code-tagged sessions", () => {
		let captured: PromptExecution | undefined;
		const runtime = createCodingRuntime({
			providerId: "codex",
			runDetachedPrompt(task) {
				captured = task;
				return {
					status: "accepted",
					ocSessionId: "oc-code-session",
				};
			},
		});

		const result = runtime.runPrompt({
			cwd: "/repo",
			prompt: "fix the tests",
		});

		expect(result).toEqual({
			status: "accepted",
			ocSessionId: "oc-code-session",
		});
		expect(captured).toMatchObject({
			cwd: "/repo",
			includeRuntimeSystemPrompt: false,
			prompt: "fix the tests",
			sessionTag: "code",
			source: "agent",
			storedSessionSource: "code",
		});
	});

	test("records explicit linked chat identity for code sessions", () => {
		let recorded:
			| {
					linkedChat?: {
						agentId: string;
						providerId: string;
						sessionId: string;
					};
			  }
			| undefined;
		let captured: PromptExecution | undefined;
		const runtime = createCodingRuntime({
			codingSessions: {
				upsert(params) {
					recorded = params;
				},
			},
			getLinkedChatSession: () => ({
				agentId: "fallback-agent",
				providerId: "fallback-provider",
				sessionId: "fallback-session",
			}),
			providerId: "codex",
			runDetachedPrompt(task) {
				captured = task;
				return {
					status: "accepted",
					ocSessionId: "oc-code-session",
				};
			},
		});

		runtime.runPrompt({
			cwd: "/repo",
			linkedChat: {
				agentId: "chat-agent",
				providerId: "claude",
				sessionId: "claude-chat",
			},
			prompt: "fix the tests",
		});
		captured?.onEvent?.({
			type: "session_initialized",
			sessionId: "codex-code",
		});

		expect(recorded?.linkedChat).toEqual({
			agentId: "chat-agent",
			providerId: "claude",
			sessionId: "claude-chat",
		});
	});

	test("auto-enlists coding repositories before recording sessions", () => {
		let captured: PromptExecution | undefined;
		let registeredCwd: string | undefined;
		let recorded:
			| {
					repositoryId?: string;
			  }
			| undefined;
		const runtime = createCodingRuntime({
			codingRepositories: {
				registerForCwd(params) {
					registeredCwd = params.cwd;
					return {
						id: "repo-outclaw",
					};
				},
			},
			codingSessions: {
				upsert(params) {
					recorded = params;
				},
			},
			defaultAgentId: "agent-railly",
			providerId: "codex",
			runDetachedPrompt(task) {
				captured = task;
				return {
					status: "accepted",
					ocSessionId: "oc-code-session",
				};
			},
		});

		runtime.runPrompt({
			cwd: "/repo/packages/app",
			prompt: "fix the tests",
		});
		captured?.onEvent?.({
			type: "session_initialized",
			sessionId: "codex-code",
		});

		expect(registeredCwd).toBe("/repo/packages/app");
		expect(recorded?.repositoryId).toBe("repo-outclaw");
	});

	test("records failed coding sessions with provider error messages", () => {
		let captured: PromptExecution | undefined;
		let failed:
			| {
					providerId: string;
					sdkSessionId: string;
					message?: string;
			  }
			| undefined;
		const recorder = {
			upsert() {},
			markFailed(params: {
				providerId: string;
				sdkSessionId: string;
				message?: string;
			}) {
				failed = params;
			},
		};
		const runtime = createCodingRuntime({
			codingSessions: recorder,
			providerId: "codex",
			runDetachedPrompt(task) {
				captured = task;
				return {
					status: "accepted",
					ocSessionId: "oc-code-session",
				};
			},
		});

		runtime.runPrompt({
			cwd: "/repo",
			prompt: "fix the tests",
		});
		captured?.onEvent?.({
			type: "session_initialized",
			sessionId: "codex-code",
		});
		captured?.onEvent?.({
			type: "error",
			sessionId: "codex-code",
			message: "Codex turn failed",
		});

		expect(failed).toEqual({
			providerId: "codex",
			sdkSessionId: "codex-code",
			message: "Codex turn failed",
		});
	});
});
