import { describe, expect, test } from "bun:test";
import type { BrowserGraphResponse } from "../../../../src/common/protocol.ts";
import {
	buildInitialSimData,
	mergeSimData,
	type SimNode,
} from "../../../../src/frontend/browser/components/right-panel/graph/graph-merge.ts";

function deterministicJitter(): () => number {
	// Always returns 0 so spawn position math is exact in tests.
	return () => 0;
}

function makeNode(id: string, overrides: Partial<SimNode> = {}): SimNode {
	return {
		id,
		name: id,
		path: id.startsWith("unresolved:") ? null : id,
		resolved: !id.startsWith("unresolved:"),
		degree: 0,
		...overrides,
	};
}

describe("mergeSimData", () => {
	test("preserves identity (object reference) for surviving nodes", () => {
		const a = makeNode("a.md", { x: 100, y: 100, vx: 0.5, vy: -0.5 });
		const b = makeNode("b.md", { x: 200, y: 200 });
		const next: BrowserGraphResponse = {
			nodes: [
				{ id: "a.md", name: "a", path: "a.md", resolved: true },
				{ id: "b.md", name: "b", path: "b.md", resolved: true },
			],
			links: [{ source: "a.md", target: "b.md" }],
		};

		const result = mergeSimData([a, b], next, {
			now: 1000,
			jitter: deterministicJitter(),
		});

		const survivingA = result.nodes.find((node) => node.id === "a.md");
		const survivingB = result.nodes.find((node) => node.id === "b.md");
		expect(survivingA).toBe(a); // same reference
		expect(survivingB).toBe(b);
		expect(survivingA?.x).toBe(100);
		expect(survivingA?.vx).toBe(0.5);
	});

	test("refreshes mutable metadata on surviving nodes", () => {
		const a = makeNode("a.md", {
			name: "old-name",
			resolved: false,
			degree: 0,
			x: 50,
			y: 50,
		});
		const next: BrowserGraphResponse = {
			nodes: [{ id: "a.md", name: "new-name", path: "a.md", resolved: true }],
			links: [],
		};

		const result = mergeSimData([a], next, { jitter: deterministicJitter() });

		const survived = result.nodes[0];
		expect(survived).toBe(a);
		expect(survived?.name).toBe("new-name");
		expect(survived?.resolved).toBe(true);
	});

	test("flags newly added nodes with birthAt and tracks them in addedIds", () => {
		const a = makeNode("a.md", { x: 100, y: 100 });
		const next: BrowserGraphResponse = {
			nodes: [
				{ id: "a.md", name: "a", path: "a.md", resolved: true },
				{ id: "b.md", name: "b", path: "b.md", resolved: true },
			],
			links: [],
		};

		const result = mergeSimData([a], next, {
			now: 5000,
			jitter: deterministicJitter(),
		});

		const newcomer = result.nodes.find((node) => node.id === "b.md");
		expect(newcomer?.birthAt).toBe(5000);
		expect(result.addedIds.has("b.md")).toBe(true);
		expect(result.addedIds.size).toBe(1);
	});

	test("spawns a new node at the centroid of its already-living peers", () => {
		const a = makeNode("a.md", { x: 100, y: 100 });
		const b = makeNode("b.md", { x: 200, y: 0 });
		const next: BrowserGraphResponse = {
			nodes: [
				{ id: "a.md", name: "a", path: "a.md", resolved: true },
				{ id: "b.md", name: "b", path: "b.md", resolved: true },
				{ id: "c.md", name: "c", path: "c.md", resolved: true },
			],
			links: [
				{ source: "c.md", target: "a.md" },
				{ source: "c.md", target: "b.md" },
			],
		};

		const result = mergeSimData([a, b], next, {
			jitter: deterministicJitter(),
		});

		const newcomer = result.nodes.find((node) => node.id === "c.md");
		// Centroid of (100,100) and (200,0) → (150, 50). Jitter is 0 here.
		expect(newcomer?.x).toBe(150);
		expect(newcomer?.y).toBe(50);
	});

	test("falls back to graph centroid when a new node has no living peers", () => {
		const a = makeNode("a.md", { x: 200, y: 0 });
		const b = makeNode("b.md", { x: 0, y: 200 });
		const next: BrowserGraphResponse = {
			nodes: [
				{ id: "a.md", name: "a", path: "a.md", resolved: true },
				{ id: "b.md", name: "b", path: "b.md", resolved: true },
				{
					id: "isolated.md",
					name: "isolated",
					path: "isolated.md",
					resolved: true,
				},
			],
			links: [],
		};

		const result = mergeSimData([a, b], next, {
			jitter: deterministicJitter(),
		});

		const newcomer = result.nodes.find((node) => node.id === "isolated.md");
		// Centroid of (200,0) and (0,200) → (100, 100).
		expect(newcomer?.x).toBe(100);
		expect(newcomer?.y).toBe(100);
	});

	test("returns removedIds for nodes no longer present", () => {
		const a = makeNode("a.md", { x: 0, y: 0 });
		const b = makeNode("b.md", { x: 0, y: 0 });
		const next: BrowserGraphResponse = {
			nodes: [{ id: "a.md", name: "a", path: "a.md", resolved: true }],
			links: [],
		};

		const result = mergeSimData([a, b], next, {
			jitter: deterministicJitter(),
		});

		expect(result.removedIds.has("b.md")).toBe(true);
		expect(result.removedIds.size).toBe(1);
		expect(result.addedIds.size).toBe(0);
	});

	test("metadata-only update yields empty addedIds and removedIds", () => {
		const a = makeNode("a.md", { x: 50, y: 50, name: "old" });
		const next: BrowserGraphResponse = {
			nodes: [{ id: "a.md", name: "new", path: "a.md", resolved: true }],
			links: [],
		};

		const result = mergeSimData([a], next, { jitter: deterministicJitter() });

		expect(result.addedIds.size).toBe(0);
		expect(result.removedIds.size).toBe(0);
		expect(result.nodes[0]?.name).toBe("new");
	});

	test("filters out links pointing at removed nodes", () => {
		const a = makeNode("a.md");
		const b = makeNode("b.md");
		const next: BrowserGraphResponse = {
			nodes: [{ id: "a.md", name: "a", path: "a.md", resolved: true }],
			links: [
				{ source: "a.md", target: "b.md" },
				{ source: "b.md", target: "a.md" },
			],
		};

		const result = mergeSimData([a, b], next, {
			jitter: deterministicJitter(),
		});

		// b.md was removed, so any link touching it must be dropped.
		expect(result.links).toEqual([]);
	});
});

describe("buildInitialSimData", () => {
	test("computes degree for every node based on incident links", () => {
		const graph: BrowserGraphResponse = {
			nodes: [
				{ id: "hub.md", name: "hub", path: "hub.md", resolved: true },
				{ id: "leaf-a.md", name: "leaf-a", path: "leaf-a.md", resolved: true },
				{ id: "leaf-b.md", name: "leaf-b", path: "leaf-b.md", resolved: true },
			],
			links: [
				{ source: "leaf-a.md", target: "hub.md" },
				{ source: "leaf-b.md", target: "hub.md" },
			],
		};

		const { nodes } = buildInitialSimData(graph);

		const byId = new Map(nodes.map((node) => [node.id, node]));
		expect(byId.get("hub.md")?.degree).toBe(2);
		expect(byId.get("leaf-a.md")?.degree).toBe(1);
		expect(byId.get("leaf-b.md")?.degree).toBe(1);
	});

	test("drops links referencing missing nodes (defensive)", () => {
		const graph: BrowserGraphResponse = {
			nodes: [{ id: "a.md", name: "a", path: "a.md", resolved: true }],
			links: [{ source: "a.md", target: "missing.md" }],
		};

		const { links } = buildInitialSimData(graph);
		expect(links).toEqual([]);
	});
});
