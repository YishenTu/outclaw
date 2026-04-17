import { describe, expect, test } from "bun:test";
import { createRightPanelRefreshStore } from "../../../src/frontend/browser/stores/right-panel-refresh.ts";

describe("right panel refresh store", () => {
	test("increments per-agent and git revisions from sidebar invalidation events", () => {
		const store = createRightPanelRefreshStore();

		store.getState().invalidate({
			type: "browser_sidebar_invalidated",
			agentId: "agent-alpha",
			sections: ["tree", "cron"],
		});
		store.getState().invalidate({
			type: "browser_sidebar_invalidated",
			sections: ["git"],
		});

		const state = store.getState();
		expect(state.treeRevisionByAgent["agent-alpha"]).toBe(1);
		expect(state.cronRevisionByAgent["agent-alpha"]).toBe(1);
		expect(state.gitRevision).toBe(1);
	});
});
