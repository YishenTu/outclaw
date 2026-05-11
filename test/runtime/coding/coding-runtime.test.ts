import { describe, expect, test } from "bun:test";
import type { FacadeEvent } from "../../../src/common/protocol.ts";
import type { PromptExecution } from "../../../src/runtime/application/prompt-execution/prompt-dispatcher.ts";
import {
	type CodingSessionEventRecorder,
	createCodingRuntime,
	type StoredCodingSessionEvent,
} from "../../../src/runtime/coding/index.ts";

function createRecordingEventLog(): CodingSessionEventRecorder & {
	recorded: StoredCodingSessionEvent[];
} {
	const recorded: StoredCodingSessionEvent[] = [];
	const sequenceByKey = new Map<string, number>();
	return {
		recorded,
		append(params) {
			const key = `${params.providerId} ${params.sdkSessionId}`;
			const sequence = (sequenceByKey.get(key) ?? 0) + 1;
			sequenceByKey.set(key, sequence);
			const stored: StoredCodingSessionEvent = {
				providerId: params.providerId,
				sdkSessionId: params.sdkSessionId,
				sequence,
				event: params.event,
				createdAt: params.timestamp ?? sequence,
			};
			recorded.push(stored);
			return stored;
		},
		list() {
			return [];
		},
		subscribe() {
			return () => {};
		},
	};
}

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
				resolveRef: () => ({ status: "not_found" }),
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
				resolveRef: () => ({ status: "not_found" }),
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
			resolveRef: () => ({ status: "not_found" as const }),
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

	test("marks the in-flight session failed even when error events lack a sessionId", async () => {
		let captured: PromptExecution | undefined;
		let failed:
			| {
					providerId: string;
					sdkSessionId: string;
					message?: string;
			  }
			| undefined;
		const runtime = createCodingRuntime({
			codingSessions: {
				resolveRef: () => ({ status: "not_found" }),
				upsert() {},
				markFailed(params) {
					failed = params;
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
			message: "transport failure",
		});

		expect(failed).toEqual({
			providerId: "codex",
			sdkSessionId: "codex-code",
			message: "transport failure",
		});
	});

	test("marks an in-flight resume failed when error arrives without a sessionId", async () => {
		let captured: PromptExecution | undefined;
		let failed:
			| {
					providerId: string;
					sdkSessionId: string;
					message?: string;
			  }
			| undefined;
		const runtime = createCodingRuntime({
			codingSessions: {
				resolveRef({ providerId, sdkSessionId }) {
					if (providerId !== "codex" || sdkSessionId !== "codex-code") {
						return { status: "not_found" };
					}
					return {
						status: "resolved",
						session: {
							storageOwnerId: "__coding__",
							providerId,
							sdkSessionId,
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
				markFailed(params) {
					failed = params;
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

		await runtime.resumePrompt({
			providerId: "codex",
			sdkSessionId: "codex-code",
			prompt: "continue",
		});
		captured?.onEvent?.({
			type: "error",
			message: "transport failure",
		});

		expect(failed).toEqual({
			providerId: "codex",
			sdkSessionId: "codex-code",
			message: "transport failure",
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
				resolveRef({ providerId, sdkSessionId }) {
					if (providerId !== "codex" || sdkSessionId !== "codex-code") {
						return { status: "not_found" };
					}
					return {
						status: "resolved",
						session: {
							storageOwnerId: "__coding__",
							providerId,
							sdkSessionId,
							cwd: "/repo",
							lifecycleStatus: "open",
							runStatus: "idle",
							createdAt: 1,
							lastActive: 2,
						},
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
				resolveRef({ providerId, sdkSessionId }) {
					if (providerId !== "codex") {
						return { status: "not_found" };
					}
					if (sdkSessionId === "closed") {
						return {
							status: "resolved",
							session: {
								storageOwnerId: "__coding__",
								providerId,
								sdkSessionId,
								cwd: "/repo",
								lifecycleStatus: "archived",
								runStatus: "idle",
								createdAt: 1,
								lastActive: 2,
							},
						};
					}
					if (sdkSessionId === "busy") {
						return {
							status: "resolved",
							session: {
								storageOwnerId: "__coding__",
								providerId,
								sdkSessionId,
								cwd: "/repo",
								lifecycleStatus: "open",
								runStatus: "running",
								createdAt: 1,
								lastActive: 2,
							},
						};
					}
					return { status: "not_found" };
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

	test("records normalized progress events during a start turn", async () => {
		let captured: PromptExecution | undefined;
		const eventLog = createRecordingEventLog();
		const runtime = createCodingRuntime({
			codingEvents: eventLog,
			codingSessions: {
				resolveRef: () => ({ status: "not_found" }),
				upsert() {},
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
			cwd: "/repo",
			prompt: "fix the tests",
		});

		const sessionInit: FacadeEvent = {
			type: "session_initialized",
			sessionId: "codex-code",
		};
		captured?.onEvent?.(sessionInit);
		await start;

		const thinking: FacadeEvent = {
			type: "thinking",
			text: "...",
			sessionId: "codex-code",
		};
		const text: FacadeEvent = {
			type: "text",
			text: "ok",
			sessionId: "codex-code",
		};
		const done: FacadeEvent = {
			type: "done",
			sessionId: "codex-code",
			durationMs: 1,
		};
		captured?.onEvent?.(thinking);
		captured?.onEvent?.(text);
		captured?.onEvent?.(done);

		expect(eventLog.recorded.map((entry) => entry.event)).toEqual([
			sessionInit,
			{ type: "user_prompt", text: "fix the tests" },
			thinking,
			text,
			done,
		]);
		expect(eventLog.recorded.map((entry) => entry.sequence)).toEqual([
			1, 2, 3, 4, 5,
		]);
		expect(
			new Set(
				eventLog.recorded.map(
					(entry) => `${entry.providerId} ${entry.sdkSessionId}`,
				),
			),
		).toEqual(new Set(["codex codex-code"]));
	});

	test("records normalized progress events during a resume turn", async () => {
		let captured: PromptExecution | undefined;
		const eventLog = createRecordingEventLog();
		const runtime = createCodingRuntime({
			codingEvents: eventLog,
			codingSessions: {
				resolveRef({ providerId, sdkSessionId }) {
					if (providerId !== "codex" || sdkSessionId !== "codex-code") {
						return { status: "not_found" };
					}
					return {
						status: "resolved",
						session: {
							storageOwnerId: "__coding__",
							providerId,
							sdkSessionId,
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
				markCompleted() {},
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

		await runtime.resumePrompt({
			providerId: "codex",
			sdkSessionId: "codex-code",
			prompt: "continue",
		});

		const text: FacadeEvent = {
			type: "text",
			text: "more",
			sessionId: "codex-code",
		};
		const done: FacadeEvent = {
			type: "done",
			sessionId: "codex-code",
			durationMs: 1,
		};
		captured?.onEvent?.(text);
		captured?.onEvent?.(done);

		expect(eventLog.recorded.map((entry) => entry.event)).toEqual([
			{ type: "user_prompt", text: "continue" },
			text,
			done,
		]);
		expect(eventLog.recorded.map((entry) => entry.sequence)).toEqual([1, 2, 3]);
	});

	test("forwards model and effort overrides on start prompts", async () => {
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

		const start = runtime.startPrompt({
			cwd: "/repo",
			prompt: "fix the tests",
			model: "gpt-5.5",
			effort: "high",
		});
		captured?.onEvent?.({
			type: "session_initialized",
			sessionId: "codex-code",
		});
		await start;

		expect(captured?.modelOverride).toBe("gpt-5.5");
		expect(captured?.effortOverride).toBe("high");
	});

	test("forwards model and effort overrides on resume prompts", async () => {
		let captured: PromptExecution | undefined;
		const runtime = createCodingRuntime({
			codingSessions: {
				resolveRef({ providerId, sdkSessionId }) {
					if (providerId !== "codex" || sdkSessionId !== "codex-code") {
						return { status: "not_found" };
					}
					return {
						status: "resolved",
						session: {
							storageOwnerId: "__coding__",
							providerId,
							sdkSessionId,
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
			runDetachedPrompt(task) {
				captured = task;
				return {
					status: "accepted",
					ocSessionId: "codex-code",
				};
			},
		});

		await runtime.resumePrompt({
			providerId: "codex",
			sdkSessionId: "codex-code",
			prompt: "continue",
			model: "gpt-5.4-mini",
			effort: "low",
		});

		expect(captured?.modelOverride).toBe("gpt-5.4-mini");
		expect(captured?.effortOverride).toBe("low");
	});
});
