import { beforeEach, describe, expect, test } from "bun:test";
import type {
	BrowserCodingRepositorySummary,
	BrowserCodingSessionSummary,
} from "../../../src/common/protocol.ts";
import {
	CODING_STORAGE_KEY,
	isPendingCodingTab,
	makeCodingFileTab,
	PENDING_CODING_PROVIDER,
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
			openTabs: [],
			repositories: [],
			sessionsByRepository: {},
			nextCursorByRepository: {},
			searchByRepository: {},
			archivedSessions: [],
			archivedNextCursor: undefined,
			archivedSearchState: undefined,
			archivedSessionsLoaded: false,
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

	test("updateSessionRunStatus refreshes a continued session in place", () => {
		useCodingStore.setState({
			sessionsByRepository: {
				"repo-a": [
					makeSession({
						providerId: "codex",
						sdkSessionId: "session-1",
						runStatus: "idle",
						lastActive: 10,
					}),
				],
				"repo-b": [
					makeSession({
						providerId: "codex",
						sdkSessionId: "session-2",
						runStatus: "idle",
						lastActive: 20,
					}),
				],
			},
		});

		useCodingStore.getState().updateSessionRunStatus("codex", "session-1", {
			runStatus: "running",
			lastActive: 30,
		});

		expect(
			useCodingStore.getState().sessionsByRepository["repo-a"]?.[0],
		).toMatchObject({
			sdkSessionId: "session-1",
			runStatus: "running",
			lastActive: 30,
		});
		expect(
			useCodingStore.getState().sessionsByRepository["repo-b"]?.[0],
		).toMatchObject({
			sdkSessionId: "session-2",
			runStatus: "idle",
			lastActive: 20,
		});
	});

	test("setCodingModels loads provider models without selecting explicit code settings", () => {
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
		expect(state.selectedModelId).toBeUndefined();
		expect(state.selectedEffort).toBeUndefined();
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

	test("removeSession spawns a pending tab when it removes the focused repo's last tab", () => {
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
		expect(state.openTabs).toHaveLength(1);
		const replacement = state.openTabs[0];
		expect(replacement).toBeDefined();
		if (!replacement) {
			return;
		}
		expect(isPendingCodingTab(replacement)).toBe(true);
		expect(replacement.repositoryId).toBe("repo-a");
		expect(state.focusedSession?.providerId).toBe(PENDING_CODING_PROVIDER);
		expect(state.focusedSession?.sdkSessionId).toBe(replacement.sdkSessionId);
	});

	test("closeTab spawns a pending replacement when closing the focused repo's last tab", () => {
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
		});

		useCodingStore.getState().closeTab("codex", "session-1");

		const state = useCodingStore.getState();
		expect(state.openTabs).toHaveLength(1);
		const replacement = state.openTabs[0];
		if (!replacement) {
			return;
		}
		expect(isPendingCodingTab(replacement)).toBe(true);
		expect(replacement.repositoryId).toBe("repo-a");
		expect(state.focusedSession?.providerId).toBe(PENDING_CODING_PROVIDER);
		expect(state.focusedSession?.sdkSessionId).toBe(replacement.sdkSessionId);
	});

	test("closeTab does not spawn when closing the last tab of a non-focused repo", () => {
		useCodingStore.setState({
			focusedRepositoryId: "repo-a",
			focusedSession: { providerId: "codex", sdkSessionId: "session-a1" },
			openTabs: [
				{
					providerId: "codex",
					sdkSessionId: "session-a1",
					repositoryId: "repo-a",
					title: "Session A1",
				},
				{
					providerId: "codex",
					sdkSessionId: "session-b1",
					repositoryId: "repo-b",
					title: "Session B1",
				},
			],
		});

		useCodingStore.getState().closeTab("codex", "session-b1");

		const state = useCodingStore.getState();
		expect(state.openTabs.map((tab) => tab.sdkSessionId)).toEqual([
			"session-a1",
		]);
		expect(state.focusedSession?.sdkSessionId).toBe("session-a1");
	});

	test("closeTab picks a neighbor from the same repo when closing the focused tab", () => {
		useCodingStore.setState({
			focusedRepositoryId: "repo-a",
			focusedSession: { providerId: "codex", sdkSessionId: "session-a2" },
			openTabs: [
				{
					providerId: "codex",
					sdkSessionId: "session-a1",
					repositoryId: "repo-a",
					title: "Session A1",
				},
				{
					providerId: "codex",
					sdkSessionId: "session-b1",
					repositoryId: "repo-b",
					title: "Session B1",
				},
				{
					providerId: "codex",
					sdkSessionId: "session-a2",
					repositoryId: "repo-a",
					title: "Session A2",
				},
			],
		});

		useCodingStore.getState().closeTab("codex", "session-a2");

		const state = useCodingStore.getState();
		expect(state.openTabs.map((tab) => tab.sdkSessionId)).toEqual([
			"session-a1",
			"session-b1",
		]);
		expect(state.focusedSession?.sdkSessionId).toBe("session-a1");
	});

	test("openTab re-anchors focusedRepositoryId to the opened tab's repo", () => {
		useCodingStore.setState({
			focusedRepositoryId: "repo-a",
			focusedSession: undefined,
			openTabs: [],
		});

		useCodingStore.getState().openTab({
			providerId: "codex",
			sdkSessionId: "session-b1",
			repositoryId: "repo-b",
			title: "Session B1",
		});

		const state = useCodingStore.getState();
		expect(state.focusedRepositoryId).toBe("repo-b");
		expect(state.focusedSession?.sdkSessionId).toBe("session-b1");
	});

	test("openTab replaces a pending tab in the same repo when opening a real session", () => {
		const pending = {
			providerId: PENDING_CODING_PROVIDER,
			sdkSessionId: "pending-repo-a",
			repositoryId: "repo-a",
			title: "New session",
		};
		useCodingStore.setState({
			focusedRepositoryId: "repo-a",
			focusedSession: {
				providerId: "codex",
				sdkSessionId: "session-a1",
			},
			openTabs: [
				{
					providerId: "codex",
					sdkSessionId: "session-a1",
					repositoryId: "repo-a",
					title: "Session A1",
				},
				pending,
			],
		});

		useCodingStore.getState().openTab({
			providerId: "codex",
			sdkSessionId: "session-a2",
			repositoryId: "repo-a",
			title: "Session A2",
		});

		const state = useCodingStore.getState();
		expect(
			state.openTabs.map((tab) => ({
				providerId: tab.providerId,
				sdkSessionId: tab.sdkSessionId,
				repositoryId: tab.repositoryId,
				title: tab.title,
			})),
		).toEqual([
			{
				providerId: "codex",
				sdkSessionId: "session-a1",
				repositoryId: "repo-a",
				title: "Session A1",
			},
			{
				providerId: "codex",
				sdkSessionId: "session-a2",
				repositoryId: "repo-a",
				title: "Session A2",
			},
		]);
		expect(state.focusedSession?.sdkSessionId).toBe("session-a2");
	});

	test("openTab keeps the pending tab when the selected real session is already open", () => {
		const pending = {
			providerId: PENDING_CODING_PROVIDER,
			sdkSessionId: "pending-repo-a",
			repositoryId: "repo-a",
			title: "New session",
		};
		useCodingStore.setState({
			focusedRepositoryId: "repo-a",
			focusedSession: {
				providerId: pending.providerId,
				sdkSessionId: pending.sdkSessionId,
			},
			openTabs: [
				{
					providerId: "codex",
					sdkSessionId: "session-a1",
					repositoryId: "repo-a",
					title: "Old title",
				},
				pending,
			],
		});

		useCodingStore.getState().openTab({
			providerId: "codex",
			sdkSessionId: "session-a1",
			repositoryId: "repo-a",
			title: "Updated title",
		});

		const state = useCodingStore.getState();
		expect(state.openTabs.map((tab) => tab.sdkSessionId)).toEqual([
			"session-a1",
			"pending-repo-a",
		]);
		expect(state.openTabs[0]?.title).toBe("Updated title");
		expect(state.focusedSession?.sdkSessionId).toBe("session-a1");
	});

	test("openTab keeps same-path file tabs separate across repositories", () => {
		useCodingStore
			.getState()
			.openTab(makeCodingFileTab("repo-a", "src/index.ts"));
		useCodingStore
			.getState()
			.openTab(makeCodingFileTab("repo-b", "src/index.ts"));

		const state = useCodingStore.getState();
		expect(
			state.openTabs.map((tab) => ({
				providerId: tab.providerId,
				sdkSessionId: tab.sdkSessionId,
				repositoryId: tab.repositoryId,
			})),
		).toEqual([
			{
				providerId: "__file__",
				sdkSessionId: "src/index.ts",
				repositoryId: "repo-a",
			},
			{
				providerId: "__file__",
				sdkSessionId: "src/index.ts",
				repositoryId: "repo-b",
			},
		]);
	});

	test("setFocusedRepository moves focus to the last tab of the target repo", () => {
		useCodingStore.setState({
			focusedRepositoryId: "repo-a",
			focusedSession: { providerId: "codex", sdkSessionId: "session-a1" },
			openTabs: [
				{
					providerId: "codex",
					sdkSessionId: "session-a1",
					repositoryId: "repo-a",
					title: "Session A1",
				},
				{
					providerId: "codex",
					sdkSessionId: "session-b1",
					repositoryId: "repo-b",
					title: "Session B1",
				},
				{
					providerId: "codex",
					sdkSessionId: "session-b2",
					repositoryId: "repo-b",
					title: "Session B2",
				},
			],
		});

		useCodingStore.getState().setFocusedRepository("repo-b");

		const state = useCodingStore.getState();
		expect(state.focusedRepositoryId).toBe("repo-b");
		expect(state.focusedSession?.sdkSessionId).toBe("session-b2");
	});

	test("setFocusedRepository spawns a pending tab when the target repo has no tabs", () => {
		useCodingStore.setState({
			focusedRepositoryId: "repo-a",
			focusedSession: { providerId: "codex", sdkSessionId: "session-a1" },
			openTabs: [
				{
					providerId: "codex",
					sdkSessionId: "session-a1",
					repositoryId: "repo-a",
					title: "Session A1",
				},
			],
		});

		useCodingStore.getState().setFocusedRepository("repo-b");

		const state = useCodingStore.getState();
		expect(state.focusedRepositoryId).toBe("repo-b");
		const repoBTabs = state.openTabs.filter(
			(tab) => tab.repositoryId === "repo-b",
		);
		expect(repoBTabs).toHaveLength(1);
		const spawned = repoBTabs[0];
		if (!spawned) {
			return;
		}
		expect(isPendingCodingTab(spawned)).toBe(true);
		expect(state.focusedSession?.providerId).toBe(PENDING_CODING_PROVIDER);
		expect(state.focusedSession?.sdkSessionId).toBe(spawned.sdkSessionId);
	});

	test("renameSession updates the matching tab title alongside session data", () => {
		useCodingStore.setState({
			focusedRepositoryId: "repo-a",
			focusedSession: { providerId: "codex", sdkSessionId: "session-1" },
			openTabs: [
				{
					providerId: "codex",
					sdkSessionId: "session-1",
					repositoryId: "repo-a",
					title: "Old title",
				},
			],
			sessionsByRepository: {
				"repo-a": [
					makeSession({
						providerId: "codex",
						sdkSessionId: "session-1",
						title: "Old title",
					}),
				],
			},
		});

		useCodingStore
			.getState()
			.renameSession("repo-a", "codex", "session-1", "New title");

		const state = useCodingStore.getState();
		expect(state.openTabs[0]?.title).toBe("New title");
		expect(state.sessionsByRepository["repo-a"]?.[0]?.title).toBe("New title");
	});

	test("setFocusedRepository keeps the focused tab when it already belongs to the target repo", () => {
		useCodingStore.setState({
			focusedRepositoryId: "repo-a",
			focusedSession: { providerId: "codex", sdkSessionId: "session-b1" },
			openTabs: [
				{
					providerId: "codex",
					sdkSessionId: "session-a1",
					repositoryId: "repo-a",
					title: "Session A1",
				},
				{
					providerId: "codex",
					sdkSessionId: "session-b1",
					repositoryId: "repo-b",
					title: "Session B1",
				},
			],
		});

		useCodingStore.getState().setFocusedRepository("repo-b");

		const state = useCodingStore.getState();
		expect(state.focusedSession?.sdkSessionId).toBe("session-b1");
		expect(
			state.openTabs.filter((tab) => tab.repositoryId === "repo-b"),
		).toHaveLength(1);
	});
});
