import { describe, expect, test } from "bun:test";
import { createPromptExecutionRuntime } from "../../../src/runtime/application/prompt-execution/prompt-execution-runtime.ts";
import { SessionService } from "../../../src/runtime/application/session-service.ts";
import { RuntimeState } from "../../../src/runtime/application/state/runtime-state.ts";

describe("PromptExecutionRuntime", () => {
	test("reports read-only providers when detached prompts are rejected before queueing", () => {
		const state = new RuntimeState("legacy");
		const runtime = createPromptExecutionRuntime({
			canRunProvider: (providerId) => providerId !== "legacy",
			providers: {
				getFacade() {
					throw new Error("provider should not run");
				},
			},
			readOnlyProviderMessage: (providerId) =>
				`Legacy ${providerId} chat sessions are read-only; start a new Pi session.`,
			sessions: new SessionService(state),
			state,
		});

		expect(
			runtime.runDetachedPrompt({
				prompt: "start coding",
				source: "agent",
			}),
		).toEqual({
			status: "rejected",
			message:
				"Legacy legacy chat sessions are read-only; start a new Pi session.",
		});
	});
});
