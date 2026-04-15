import { describe, expect, test } from "bun:test";
import type { DoneEvent, FacadeEvent } from "../../../src/common/protocol.ts";
import type { PromptDispatcher } from "../../../src/runtime/application/prompt-dispatcher.ts";
import { RuntimeExecutionCoordinator } from "../../../src/runtime/application/runtime-execution-coordinator.ts";
import { RuntimeState } from "../../../src/runtime/application/runtime-state.ts";
import { SessionService } from "../../../src/runtime/application/session-service.ts";

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

describe("RuntimeExecutionCoordinator", () => {
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
});
