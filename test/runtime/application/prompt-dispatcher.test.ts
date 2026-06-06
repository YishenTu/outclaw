import { describe, expect, test } from "bun:test";
import type {
	OutclawNativeToolContext,
	OutclawNativeToolHost,
} from "../../../src/common/native-tools.ts";
import { PromptDispatcher } from "../../../src/runtime/application/prompt-execution/prompt-dispatcher.ts";

describe("PromptDispatcher native tool context", () => {
	test("treats heartbeat and rollover as writable agent turns", async () => {
		const contexts: OutclawNativeToolContext[] = [];
		const dispatcher = new PromptDispatcher({
			clients: {
				listBrowserTargets: () => [],
				listInteractiveTargets: () => [],
				send: () => {},
				sendMany: () => {},
			},
			createNativeToolHost: ({ readOnly, task }) => {
				contexts.push({
					agentId: "agent-default",
					agentName: "Default",
					source: task.source,
					readOnly,
				});
				return {} as OutclawNativeToolHost;
			},
			promptRunner: {
				run: async () => {},
			} as never,
			sessions: {} as never,
			state: {
				sessionId: "session-1",
				createHeartbeatDeliveryTarget: () => undefined,
			} as never,
			streamingState: {
				clear: () => {},
			} as never,
		});

		await dispatcher.run(
			{ prompt: "heartbeat", source: "heartbeat" },
			promptContext(),
			new AbortController(),
		);
		await dispatcher.run(
			{ prompt: "rollover", source: "rollover" },
			promptContext(),
			new AbortController(),
		);
		await dispatcher.run(
			{ prompt: "interactive", source: "browser" },
			promptContext(),
			new AbortController(),
		);

		expect(contexts).toEqual([
			{
				agentId: "agent-default",
				agentName: "Default",
				source: "heartbeat",
				readOnly: false,
			},
			{
				agentId: "agent-default",
				agentName: "Default",
				source: "rollover",
				readOnly: false,
			},
			{
				agentId: "agent-default",
				agentName: "Default",
				source: "browser",
				readOnly: false,
			},
		]);
	});
});

function promptContext() {
	return {
		effort: "medium" as const,
		generation: 1,
		isVisible: () => false,
		model: "anthropic/claude-sonnet-4-5",
		ocSessionId: "oc-session",
		providerId: "pi",
		resolvedModel: "anthropic/claude-sonnet-4-5",
		sessionId: "session-1",
		sessionSource: "tui" as const,
	};
}
