import { describe, expect, test } from "bun:test";
import { GIT_GRAPH_STYLE } from "../../../src/frontend/browser/components/right-panel/git-graph-style.ts";

describe("GIT_GRAPH_STYLE", () => {
	test("uses tighter vertical commit spacing for the compact sidebar graph", () => {
		expect(GIT_GRAPH_STYLE.commitSpacing).toBe(28);
	});
});
