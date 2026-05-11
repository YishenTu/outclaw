import { describe, expect, test } from "bun:test";
import type { PromptExecution } from "../../../src/runtime/application/prompt-execution/prompt-dispatcher.ts";
import { createCodingRuntime } from "../../../src/runtime/coding/index.ts";

describe("CodingRuntime", () => {
	test("starts code prompts as detached code-tagged sessions and waits for provider identity", async () => {
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

		let settled = false;
		const start = runtime
			.startPrompt({
				cwd: "/repo",
				prompt: "fix the tests",
			})
			.then((result) => {
				settled = true;
				return result;
			});

		await Promise.resolve();
		expect(settled).toBe(false);
		expect(captured).toMatchObject({
			cwd: "/repo",
			includeRuntimeSystemPrompt: false,
			prompt: "fix the tests",
			sessionTag: "code",
			source: "agent",
			storedSessionSource: "code",
		});

		captured?.onEvent?.({
			type: "session_initialized",
			sessionId: "codex-code-session",
		});

		await expect(start).resolves.toEqual({
			status: "accepted",
			providerId: "codex",
			sdkSessionId: "codex-code-session",
		});
	});

	test("rejects start when detached execution cannot be queued", async () => {
		const runtime = createCodingRuntime({
			providerId: "codex",
			runDetachedPrompt() {
				return {
					status: "rejected",
					message: "Runtime shutting down",
				};
			},
		});

		await expect(
			runtime.startPrompt({
				cwd: "/repo",
				prompt: "fix the tests",
			}),
		).resolves.toEqual({
			status: "rejected",
			message: "Runtime shutting down",
		});
	});

	test("runs code prompts as detached code-tagged sessions", async () => {
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

		const resultPromise = runtime.startPrompt({
			cwd: "/repo",
			prompt: "fix the tests",
		});
		captured?.onEvent?.({
			type: "session_initialized",
			sessionId: "codex-code-session",
		});

		await expect(resultPromise).resolves.toEqual({
			status: "accepted",
			providerId: "codex",
			sdkSessionId: "codex-code-session",
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

	test("records explicit linked chat session id for code sessions", async () => {
		let recorded:
			| {
					linkedChatSessionId?: string;
			  }
			| undefined;
		let captured: PromptExecution | undefined;
		const runtime = createCodingRuntime({
			codingSessions: {
				upsert(params) {
					recorded = params;
				},
			},
			getLinkedChatSessionId: () => "fallback-session",
			providerId: "codex",
			runDetachedPrompt(task) {
				captured = task;
				return {
					status: "accepted",
					ocSessionId: "oc-code-session",
				};
			},
		});

		const start = runtime.startPrompt({
			cwd: "/repo",
			linkedChatSessionId: "claude-chat",
			prompt: "fix the tests",
		});
		captured?.onEvent?.({
			type: "session_initialized",
			sessionId: "codex-code",
		});

		await expect(start).resolves.toMatchObject({
			sdkSessionId: "codex-code",
		});
		expect(recorded?.linkedChatSessionId).toBe("claude-chat");
	});

	test("auto-enlists coding repositories before recording sessions", async () => {
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
			providerId: "codex",
			runDetachedPrompt(task) {
				captured = task;
				return {
					status: "accepted",
					ocSessionId: "oc-code-session",
				};
			},
		});

		const start = runtime.startPrompt({
			cwd: "/repo/packages/app",
			prompt: "fix the tests",
		});
		captured?.onEvent?.({
			type: "session_initialized",
			sessionId: "codex-code",
		});

		await expect(start).resolves.toMatchObject({
			sdkSessionId: "codex-code",
		});
		expect(registeredCwd).toBe("/repo/packages/app");
		expect(recorded?.repositoryId).toBe("repo-outclaw");
	});

	test("records failed coding sessions with provider error messages", async () => {
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

		const start = runtime.startPrompt({
			cwd: "/repo",
			prompt: "fix the tests",
		});
		captured?.onEvent?.({
			type: "session_initialized",
			sessionId: "codex-code",
		});
		await expect(start).resolves.toMatchObject({
			sdkSessionId: "codex-code",
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

	test("resumes an open idle coding session by provider thread identity", async () => {
		let captured: PromptExecution | undefined;
		let markedRunning:
			| {
					providerId: string;
					sdkSessionId: string;
			  }
			| undefined;
		let markedCompleted:
			| {
					providerId: string;
					sdkSessionId: string;
			  }
			| undefined;
		const runtime = createCodingRuntime({
			codingSessions: {
				get(providerId, sdkSessionId) {
					if (providerId !== "codex" || sdkSessionId !== "codex-code") {
						return undefined;
					}
					return {
						storageOwnerId: "__coding__",
						providerId,
						sdkSessionId,
						cwd: "/repo",
						lifecycleStatus: "open",
						runStatus: "idle",
						createdAt: 1,
						lastActive: 2,
					};
				},
				upsert() {},
				markRunning(params) {
					markedRunning = params;
				},
				markCompleted(params) {
					markedCompleted = params;
				},
			},
			providerId: "codex",
			runDetachedPrompt(task) {
				captured = task;
				return {
					status: "accepted",
					ocSessionId: "codex-code",
				};
			},
		});

		await expect(
			runtime.resumePrompt({
				providerId: "codex",
				sdkSessionId: "codex-code",
				prompt: "continue the fix",
			}),
		).resolves.toEqual({
			status: "accepted",
			providerId: "codex",
			sdkSessionId: "codex-code",
		});

		expect(captured).toMatchObject({
			cwd: "/repo",
			includeRuntimeSystemPrompt: false,
			prompt: "continue the fix",
			resumeSessionId: "codex-code",
			sessionTag: "code",
			source: "agent",
			storedSessionSource: "code",
		});
		expect(markedRunning).toEqual({
			providerId: "codex",
			sdkSessionId: "codex-code",
		});

		captured?.onEvent?.({
			type: "done",
			sessionId: "codex-code",
			durationMs: 1,
		});

		expect(markedCompleted).toEqual({
			providerId: "codex",
			sdkSessionId: "codex-code",
		});
	});

	test("rejects resume for provider mismatch, unknown, closed, or busy sessions", async () => {
		const runtime = createCodingRuntime({
			codingSessions: {
				get(providerId, sdkSessionId) {
					if (providerId !== "codex") {
						return undefined;
					}
					if (sdkSessionId === "closed") {
						return {
							storageOwnerId: "__coding__",
							providerId,
							sdkSessionId,
							cwd: "/repo",
							lifecycleStatus: "archived",
							runStatus: "idle",
							createdAt: 1,
							lastActive: 2,
						};
					}
					if (sdkSessionId === "busy") {
						return {
							storageOwnerId: "__coding__",
							providerId,
							sdkSessionId,
							cwd: "/repo",
							lifecycleStatus: "open",
							runStatus: "running",
							createdAt: 1,
							lastActive: 2,
						};
					}
					return undefined;
				},
				upsert() {},
			},
			providerId: "codex",
			runDetachedPrompt() {
				throw new Error("resume should not run");
			},
		});

		await expect(
			runtime.resumePrompt({
				providerId: "claude",
				sdkSessionId: "code",
				prompt: "continue",
			}),
		).resolves.toEqual({
			status: "rejected",
			message: "Coding provider mismatch: claude",
		});
		await expect(
			runtime.resumePrompt({
				providerId: "codex",
				sdkSessionId: "missing",
				prompt: "continue",
			}),
		).resolves.toEqual({
			status: "rejected",
			message: "Unknown coding session: codex/missing",
		});
		await expect(
			runtime.resumePrompt({
				providerId: "codex",
				sdkSessionId: "closed",
				prompt: "continue",
			}),
		).resolves.toEqual({
			status: "rejected",
			message: "Coding session is not open: codex/closed",
		});
		await expect(
			runtime.resumePrompt({
				providerId: "codex",
				sdkSessionId: "busy",
				prompt: "continue",
			}),
		).resolves.toEqual({
			status: "rejected",
			message: "Coding session is busy: codex/busy",
		});
	});

	test("resumes by an unambiguous bare provider session id", async () => {
		let resolvedRef:
			| {
					providerId?: string;
					sdkSessionId: string;
			  }
			| undefined;
		const runtime = createCodingRuntime({
			codingSessions: {
				resolveRef(params) {
					resolvedRef = params;
					return {
						status: "resolved",
						session: {
							storageOwnerId: "__coding__",
							providerId: "codex",
							sdkSessionId: "codex-code",
							cwd: "/repo",
							lifecycleStatus: "open",
							runStatus: "idle",
							createdAt: 1,
							lastActive: 2,
						},
					};
				},
				upsert() {},
				markRunning() {},
			},
			providerId: "codex",
			runDetachedPrompt() {
				return {
					status: "accepted",
					ocSessionId: "codex-code",
				};
			},
		});

		await expect(
			runtime.resumePrompt({
				sdkSessionId: "codex-code",
				prompt: "continue",
			}),
		).resolves.toEqual({
			status: "accepted",
			providerId: "codex",
			sdkSessionId: "codex-code",
		});
		expect(resolvedRef).toEqual({
			sdkSessionId: "codex-code",
		});
	});
});
