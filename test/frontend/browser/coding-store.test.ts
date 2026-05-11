import { beforeEach, describe, expect, test } from "bun:test";
import type {
	BrowserCodingRepositorySummary,
	BrowserCodingSessionSummary,
} from "../../../src/common/protocol.ts";
import {
	CODING_STORAGE_KEY,
	useCodingStore,
} from "../../../src/frontend/browser/coding/coding-store.ts";

function makeRepo(id: string): BrowserCodingRepositorySummary {
	return {
		id,
		rootCwd: `/repos/${id}`,
		displayName: id,
		source: "manual",
		status: "active",
		createdAt: 1,
		lastActive: 1,
	};
}

function makeSession(
	overrides: Partial<BrowserCodingSessionSummary> & {
		providerId: string;
		sdkSessionId: string;
	},
): BrowserCodingSessionSummary {
	return {
		title: overrides.sdkSessionId,
		model: "model",
		lastActive: 1,
		cwd: "/repos/repo-a",
		lifecycleStatus: "open",
		runStatus: "idle",
		createdAt: 1,
		source: "manual",
		tag: "code",
		...overrides,
	};
}

describe("useCodingStore", () => {
	beforeEach(() => {
		useCodingStore.setState({
			appMode: "chat",
			focusedRepositoryId: undefined,
			focusedSession: undefined,
			repositories: [],
			sessionsByRepository: {},
			repositoriesLoaded: false,
			codingModels: [],
			codingModelsLoaded: false,
			selectedModelId: undefined,
			selectedEffort: undefined,
		});
		if (typeof globalThis.localStorage !== "undefined") {
			globalThis.localStorage.removeItem(CODING_STORAGE_KEY);
		}
	});

	test("clears focusedRepositoryId when the focused repo disappears from the new list", () => {
		useCodingStore.setState({
			focusedRepositoryId: "repo-a",
			focusedSession: {
				providerId: "codex",
				sdkSessionId: "session-1",
			},
		});

		useCodingStore.getState().setRepositories([makeRepo("repo-b")]);

		expect(useCodingStore.getState().focusedRepositoryId).toBeUndefined();
		expect(useCodingStore.getState().focusedSession).toBeUndefined();
		expect(useCodingStore.getState().repositoriesLoaded).toBe(true);
	});

	test("keeps focusedRepositoryId when the focused repo is still present", () => {
		useCodingStore.setState({
			focusedRepositoryId: "repo-a",
			focusedSession: {
				providerId: "codex",
				sdkSessionId: "session-1",
			},
		});

		useCodingStore
			.getState()
			.setRepositories([makeRepo("repo-a"), makeRepo("repo-b")]);

		expect(useCodingStore.getState().focusedRepositoryId).toBe("repo-a");
		expect(useCodingStore.getState().focusedSession?.sdkSessionId).toBe(
			"session-1",
		);
	});

	test("removeSession drops the session, closes its tab, and re-focuses a neighbor", () => {
		useCodingStore.setState({
			focusedRepositoryId: "repo-a",
			focusedSession: { providerId: "codex", sdkSessionId: "session-1" },
			openTabs: [
				{
					providerId: "codex",
					sdkSessionId: "session-1",
					repositoryId: "repo-a",
					title: "Session 1",
				},
				{
					providerId: "codex",
					sdkSessionId: "session-2",
					repositoryId: "repo-a",
					title: "Session 2",
				},
			],
			sessionsByRepository: {
				"repo-a": [
					makeSession({ providerId: "codex", sdkSessionId: "session-1" }),
					makeSession({ providerId: "codex", sdkSessionId: "session-2" }),
				],
			},
		});

		useCodingStore.getState().removeSession("repo-a", "codex", "session-1");

		const state = useCodingStore.getState();
		expect(
			state.sessionsByRepository["repo-a"]?.map((s) => s.sdkSessionId),
		).toEqual(["session-2"]);
		expect(state.openTabs.map((t) => t.sdkSessionId)).toEqual(["session-2"]);
		expect(state.focusedSession?.sdkSessionId).toBe("session-2");
	});

	test("setCodingModels picks the default model and resets effort to its default", () => {
		useCodingStore.getState().setCodingModels([
			{
				id: "gpt-5.5",
				model: "gpt-5.5",
				displayName: "GPT-5.5",
				description: "frontier",
				isDefault: true,
				defaultReasoningEffort: "medium",
				supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
				serviceTiers: [],
			},
			{
				id: "gpt-5.4-mini",
				model: "gpt-5.4-mini",
				displayName: "GPT-5.4-Mini",
				description: "small",
				isDefault: false,
				defaultReasoningEffort: "medium",
				supportedReasoningEfforts: ["low", "medium"],
				serviceTiers: [],
			},
		]);

		const state = useCodingStore.getState();
		expect(state.codingModels).toHaveLength(2);
		expect(state.selectedModelId).toBe("gpt-5.5");
		expect(state.selectedEffort).toBe("medium");
	});

	test("setSelectedModelId clamps effort to the new model's supported list", () => {
		useCodingStore.getState().setCodingModels([
			{
				id: "gpt-5.5",
				model: "gpt-5.5",
				displayName: "GPT-5.5",
				description: "",
				isDefault: true,
				defaultReasoningEffort: "medium",
				supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
				serviceTiers: [],
			},
			{
				id: "gpt-5.4-mini",
				model: "gpt-5.4-mini",
				displayName: "GPT-5.4-Mini",
				description: "",
				isDefault: false,
				defaultReasoningEffort: "low",
				supportedReasoningEfforts: ["low", "medium"],
				serviceTiers: [],
			},
		]);
		useCodingStore.getState().setSelectedEffort("xhigh");
		expect(useCodingStore.getState().selectedEffort).toBe("xhigh");

		useCodingStore.getState().setSelectedModelId("gpt-5.4-mini");

		expect(useCodingStore.getState().selectedModelId).toBe("gpt-5.4-mini");
		expect(useCodingStore.getState().selectedEffort).toBe("low");
	});

	test("removeSession clears focusedSession when no tabs remain", () => {
		useCodingStore.setState({
			focusedRepositoryId: "repo-a",
			focusedSession: { providerId: "codex", sdkSessionId: "session-1" },
			openTabs: [
				{
					providerId: "codex",
					sdkSessionId: "session-1",
					repositoryId: "repo-a",
					title: "Session 1",
				},
			],
			sessionsByRepository: {
				"repo-a": [
					makeSession({ providerId: "codex", sdkSessionId: "session-1" }),
				],
			},
		});

		useCodingStore.getState().removeSession("repo-a", "codex", "session-1");

		const state = useCodingStore.getState();
		expect(state.sessionsByRepository["repo-a"]).toEqual([]);
		expect(state.openTabs).toEqual([]);
		expect(state.focusedSession).toBeUndefined();
	});
});
