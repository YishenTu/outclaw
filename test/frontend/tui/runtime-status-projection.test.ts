import { describe, expect, test } from "bun:test";
import {
	projectRuntimeInfoEvent,
	projectRuntimeStatus,
} from "../../../src/frontend/tui/events/runtime-status-projection.ts";

describe("TUI runtime status projection", () => {
	test("projects runtime status into status-bar info", () => {
		expect(
			projectRuntimeStatus({
				event: {
					type: "runtime_status",
					agentName: "railly",
					model: "sonnet",
					effort: "think",
					running: true,
					notice: { kind: "restart_required" },
					usage: {
						inputTokens: 0,
						outputTokens: 0,
						cacheCreationTokens: 0,
						cacheReadTokens: 0,
						contextTokens: 1200,
						contextWindow: 200000,
						maxOutputTokens: 32000,
						percentage: 1,
					},
					nextHeartbeatAt: 12345,
					heartbeatDeferred: true,
				},
				previous: {},
			}),
		).toEqual({
			agentName: "railly",
			running: true,
			runtimeInfo: {
				agentName: "railly",
				model: "sonnet",
				effort: "think",
				notice: "Restart required",
				contextTokens: 1200,
				contextWindow: 200000,
				nextHeartbeatAt: 12345,
				heartbeatDeferred: true,
			},
		});
	});

	test("preserves known agent name when status omits it", () => {
		expect(
			projectRuntimeStatus({
				event: {
					type: "runtime_status",
					model: "opus",
					effort: "high",
					running: false,
				},
				knownAgentName: "mimi",
				previous: { agentName: "older" },
			}).runtimeInfo.agentName,
		).toBe("mimi");
	});

	test("projects rollover runtime notices to concise TUI copy", () => {
		expect(
			projectRuntimeStatus({
				event: {
					type: "runtime_status",
					model: "sonnet",
					effort: "think",
					running: false,
					notice: {
						kind: "rollover",
						message:
							"Previous session auto-finalized after 8h idle. A new session will begin with your next message. Use /session to resume.",
					},
				},
				previous: {},
			}).runtimeInfo.notice,
		).toBe("Rollover done; next prompt starts a new session.");
	});

	test("preserves rollover final-check failure in concise TUI copy", () => {
		expect(
			projectRuntimeStatus({
				event: {
					type: "runtime_status",
					model: "sonnet",
					effort: "think",
					running: false,
					notice: {
						kind: "rollover",
						message:
							"Previous session auto-finalized after 8h idle. A new session will begin with your next message. Use /session to resume.",
						finalCheck: "failed",
					},
				},
				previous: {},
			}).runtimeInfo.notice,
		).toBe("Rollover final check failed; next prompt starts a new session.");
	});

	test("applies incremental agent, model, and effort events", () => {
		expect(
			projectRuntimeInfoEvent(
				{ agentName: "old", model: "sonnet", effort: "think" },
				{ type: "agent_switched", agentId: "agent-a", name: "railly" },
			),
		).toEqual({ agentName: "railly", model: "sonnet", effort: "think" });
		expect(
			projectRuntimeInfoEvent(
				{ agentName: "railly", model: "sonnet", effort: "think" },
				{ type: "model_changed", model: "opus" },
			).model,
		).toBe("opus");
		expect(
			projectRuntimeInfoEvent(
				{ agentName: "railly", model: "opus", effort: "think" },
				{ type: "effort_changed", effort: "ultrathink" },
			).effort,
		).toBe("ultrathink");
	});
});
