import { describe, expect, test } from "bun:test";
import {
	createRightPanelRefreshStore,
	selectAgentTreeRevision,
	selectGitRevision,
} from "../../../src/frontend/browser/stores/right-panel-refresh.ts";

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

	test("exposes stable preview refresh selectors for file and git previews", () => {
		const store = createRightPanelRefreshStore();

		expect(selectAgentTreeRevision(store.getState(), "agent-alpha")).toBe(0);
		expect(selectAgentTreeRevision(store.getState(), null)).toBe(0);
		expect(selectGitRevision(store.getState())).toBe(0);

		store.getState().invalidate({
			type: "browser_sidebar_invalidated",
			agentId: "agent-alpha",
			sections: ["tree"],
		});
		store.getState().invalidate({
			type: "browser_sidebar_invalidated",
			sections: ["git"],
		});

		expect(selectAgentTreeRevision(store.getState(), "agent-alpha")).toBe(1);
		expect(selectAgentTreeRevision(store.getState(), "agent-beta")).toBe(0);
		expect(selectGitRevision(store.getState())).toBe(1);
	});
});
