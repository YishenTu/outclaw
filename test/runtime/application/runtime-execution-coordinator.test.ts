import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { DoneEvent, FacadeEvent } from "../../../src/common/protocol.ts";
import type { PromptDispatcher } from "../../../src/runtime/application/prompt-execution/prompt-dispatcher.ts";
import { RuntimeExecutionCoordinator } from "../../../src/runtime/application/runtime-execution-coordinator.ts";
import { SessionService } from "../../../src/runtime/application/session-service.ts";
import { RuntimeState } from "../../../src/runtime/application/state/runtime-state.ts";
import { SessionStore } from "../../../src/runtime/persistence/session-store/session-store.ts";

const TEST_DB = join(
	import.meta.dir,
	".tmp-runtime-execution-coordinator.sqlite",
);

function createDeferred() {
	let resolve: () => void = () => {};
	const promise = new Promise<void>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

function makeDoneEvent(sessionId = "sdk-active"): DoneEvent {
	return {
		type: "done",
		sessionId,
		durationMs: 1,
		costUsd: 0,
		usage: {
			inputTokens: 1,
			outputTokens: 1,
			cacheCreationTokens: 0,
			cacheReadTokens: 0,
			contextWindow: 200_000,
			maxOutputTokens: 8_000,
			contextTokens: 2,
			percentage: 0.001,
		},
	};
}

function retainedLaneCount(coordinator: RuntimeExecutionCoordinator): number {
	return (
		coordinator as unknown as {
			lanes: Map<string, unknown>;
		}
	).lanes.size;
}

describe("RuntimeExecutionCoordinator", () => {
	afterEach(() => {
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
		if (existsSync(`${TEST_DB}-wal`)) rmSync(`${TEST_DB}-wal`);
		if (existsSync(`${TEST_DB}-shm`)) rmSync(`${TEST_DB}-shm`);
	});

	test("accepted user prompts update the last user target immediately", async () => {
		const state = new RuntimeState("mock");
		const sessions = new SessionService(state);
		const release = createDeferred();
		let callCount = 0;
		const coordinator = new RuntimeExecutionCoordinator({
			promptDispatcher: {
				run: async () => {
					callCount += 1;
					if (callCount === 1) {
						await release.promise;
					}
				},
			} as Pick<PromptDispatcher, "run">,
			sessions,
			state,
		});

		coordinator.enqueuePrompt({
			prompt: "hello from telegram",
			source: "telegram",
			telegramChatId: 123,
		});
		coordinator.enqueuePrompt({
			prompt: "hello from tui",
			source: "tui",
		});

		expect(state.createHeartbeatDeliveryTarget()).toEqual({
			clientType: "tui",
		});

		release.resolve();
		await coordinator.drain();
	});

	test("agent prompts do not mutate the last user target", async () => {
		const state = new RuntimeState("mock");
		const sessions = new SessionService(state);
		sessions.recordAcceptedPromptTarget("telegram", 123);
		const events: FacadeEvent[] = [{ type: "text", text: "done" }];
		const coordinator = new RuntimeExecutionCoordinator({
			promptDispatcher: {
				run: async (task) => {
					for (const event of events) {
						task.onEvent?.(event);
					}
				},
			} as Pick<PromptDispatcher, "run">,
			sessions,
			state,
		});

		await coordinator.enqueueAgentPrompt({
			prompt: "internal request",
			source: "agent",
		});

		expect(state.createHeartbeatDeliveryTarget()).toEqual({
			clientType: "telegram",
			telegramChatId: 123,
		});
	});

	test("agent prompts do not count as user activity for heartbeat deferral", async () => {
		const originalNow = Date.now;
		let now = 0;
		Date.now = () => now;

		try {
			const state = new RuntimeState("mock");
			const sessions = new SessionService(state);
			sessions.completeRun(makeDoneEvent("sdk-chat"), "tui");
			const coordinator = new RuntimeExecutionCoordinator({
				promptDispatcher: {
					run: async () => {},
				} as Pick<PromptDispatcher, "run">,
				sessions,
				state,
			});

			now = 50_000;
			await coordinator.enqueueAgentPrompt({
				prompt: "internal request",
				source: "agent",
			});

			expect(coordinator.shouldAttemptHeartbeat(61_000, 1)).toBe("attempt");
		} finally {
			Date.now = originalNow;
		}
	});

	test("rollover prompts detach the active session before the background finalize completes", async () => {
		const store = new SessionStore(TEST_DB, { journalMode: "DELETE" });
		const state = new RuntimeState("mock");
		const sessions = new SessionService(state, store);
		store.setLastInteractiveAt(123);
		state.preparePrompt("Old session");
		sessions.completeRun(makeDoneEvent("sdk-old"));
		let source: string | undefined;
		const release = createDeferred();

		const coordinator = new RuntimeExecutionCoordinator({
			promptDispatcher: {
				run: async (task) => {
					source = task.source;
					expect(state.sessionId).toBeUndefined();
					expect(store.getActiveSessionId("mock")).toBeUndefined();
					expect(store.getLastHandledRolloverInteractiveAt()).toBe(123);
					expect(store.getRolloverNotice()).toEqual({
						kind: "rollover",
						message:
							"Previous session auto-finalized after 8h idle. A new session will begin with your next message. Use /session to resume.",
					});
					await release.promise;
					task.onEvent?.({
						type: "done",
						sessionId: "sdk-old",
						durationMs: 1,
					});
				},
			} as Pick<PromptDispatcher, "run">,
			sessions,
			state,
		});

		expect(coordinator.enqueueRollover("finalize the old session", 480)).toBe(
			true,
		);
		release.resolve();
		await coordinator.drain();

		expect(source).toBe("rollover");
		expect(state.sessionId).toBeUndefined();
		expect(store.getActiveSessionId("mock")).toBeUndefined();
		expect(store.getLastHandledRolloverInteractiveAt()).toBe(123);
		expect(store.getRolloverNotice()).toEqual({
			kind: "rollover",
			message:
				"Previous session auto-finalized after 8h idle. A new session will begin with your next message. Use /session to resume.",
		});

		store.close();
	});

	test("completed detached prompts retire their execution lane", async () => {
		const state = new RuntimeState("mock");
		const sessions = new SessionService(state);
		const release = createDeferred();
		const coordinator = new RuntimeExecutionCoordinator({
			promptDispatcher: {
				run: async (task) => {
					await release.promise;
					task.onEvent?.({
						type: "done",
						sessionId: "sdk-code",
						durationMs: 1,
					});
				},
			} as Pick<PromptDispatcher, "run">,
			sessions,
			state,
		});

		expect(
			coordinator.enqueueDetachedPrompt({
				prompt: "fix tests",
				source: "agent",
			}),
		).toMatchObject({ ocSessionId: expect.any(String) });
		expect(retainedLaneCount(coordinator)).toBe(1);

		release.resolve();
		await coordinator.drain();

		expect(retainedLaneCount(coordinator)).toBe(0);
	});

	test("detached prompt handles abort their own active run", async () => {
		const state = new RuntimeState("mock");
		const sessions = new SessionService(state);
		const release = createDeferred();
		let signal: AbortSignal | undefined;
		const coordinator = new RuntimeExecutionCoordinator({
			promptDispatcher: {
				run: async (_task, _context, abortController) => {
					signal = abortController.signal;
					await release.promise;
				},
			} as Pick<PromptDispatcher, "run">,
			sessions,
			state,
		});

		const detached = coordinator.enqueueDetachedPrompt({
			prompt: "fix tests",
			source: "agent",
		});

		expect(detached).toMatchObject({ ocSessionId: expect.any(String) });
		expect(detached?.abort()).toBe(true);
		expect(signal?.aborted).toBe(true);

		release.resolve();
		await coordinator.drain();

		expect(detached?.abort()).toBe(false);
	});
});
