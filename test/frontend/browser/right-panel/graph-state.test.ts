import { describe, expect, test } from "bun:test";
import type { BrowserGraphResponse } from "../../../../src/common/protocol.ts";
import {
	graphForAgent,
	resolveGraphFocusedIds,
} from "../../../../src/frontend/browser/components/right-panel/graph/graph-state.ts";

function graphWithNodes(ids: string[]): BrowserGraphResponse {
	return {
		nodes: ids.map((id) => ({
			id,
			name: id,
			path: id,
			resolved: true,
		})),
		links: [],
	};
}

describe("graphForAgent", () => {
	test("ignores graph data loaded for a previous active agent", () => {
		const graph = graphWithNodes(["agent-a-note.md"]);

		expect(graphForAgent({ agentId: "agent-a", graph }, "agent-b")).toBeNull();
		expect(graphForAgent({ agentId: "agent-a", graph }, "agent-a")).toBe(graph);
	});
});

describe("resolveGraphFocusedIds", () => {
	test("ignores an active file path that is not present in the graph", () => {
		const focused = resolveGraphFocusedIds({
			activeFilePath: "config.json",
			hoveredId: null,
			nodeIds: new Set(["note.md"]),
		});

		expect(Array.from(focused)).toEqual([]);
	});

	test("keeps hover focus when the active file is not present in the graph", () => {
		const focused = resolveGraphFocusedIds({
			activeFilePath: "config.json",
			hoveredId: "note.md",
			nodeIds: new Set(["note.md"]),
		});

		expect(Array.from(focused)).toEqual(["note.md"]);
	});
});
