import { describe, expect, test } from "bun:test";
import { resolveAgentDropIndicator } from "../../../src/frontend/browser/components/agent-sidebar/resolve-agent-drop-indicator.ts";

describe("resolveAgentDropIndicator", () => {
	const rows = [
		{ agentId: "agent-a", top: 100, height: 20 },
		{ agentId: "agent-b", top: 140, height: 20 },
		{ agentId: "agent-c", top: 180, height: 20 },
	];

	test("returns before the first remaining row when dragging near the top", () => {
		expect(resolveAgentDropIndicator(rows, "agent-b", 90)).toEqual({
			agentId: "agent-a",
			position: "before",
		});
	});

	test("returns before a row when the pointer is in its upper half", () => {
		expect(resolveAgentDropIndicator(rows, "agent-a", 145)).toEqual({
			agentId: "agent-b",
			position: "before",
		});
	});

	test("returns after the last remaining row when dragging near the bottom", () => {
		expect(resolveAgentDropIndicator(rows, "agent-a", 230)).toEqual({
			agentId: "agent-c",
			position: "after",
		});
	});

	test("returns null when no other rows are available", () => {
		expect(
			resolveAgentDropIndicator(
				[{ agentId: "agent-a", top: 100, height: 20 }],
				"agent-a",
				110,
			),
		).toBeNull();
	});
});
