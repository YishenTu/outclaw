import { describe, expect, test } from "bun:test";
import { resolveWelcomeAgentId } from "../../../src/frontend/browser/welcome-agent-selection.ts";

describe("resolveWelcomeAgentId", () => {
	test("keeps the current active agent when it still exists", () => {
		expect(
			resolveWelcomeAgentId(
				[
					{ agentId: "agent-alpha", name: "alpha" },
					{ agentId: "agent-beta", name: "beta" },
				],
				"agent-beta",
			),
		).toBe("agent-beta");
	});

	test("falls back to the first available agent when the active one is missing", () => {
		expect(
			resolveWelcomeAgentId(
				[
					{ agentId: "agent-alpha", name: "alpha" },
					{ agentId: "agent-beta", name: "beta" },
				],
				"agent-gone",
			),
		).toBe("agent-alpha");
	});

	test("returns null when no agents are available", () => {
		expect(resolveWelcomeAgentId([], "agent-alpha")).toBeNull();
	});
});
