import { beforeEach, describe, expect, test } from "bun:test";
import type {
	BrowserCodingSessionPageResponse,
	BrowserCodingSessionSummary,
} from "../../../src/common/protocol.ts";
import { refreshLoadedCodingSessionState } from "../../../src/frontend/browser/coding/coding-session-refresh.ts";
import { useCodingStore } from "../../../src/frontend/browser/coding/coding-store.ts";

function session(
	overrides: Partial<BrowserCodingSessionSummary> & {
		providerId?: string;
		sdkSessionId?: string;
	},
): BrowserCodingSessionSummary {
	return {
		providerId: overrides.providerId ?? "codex",
		sdkSessionId: overrides.sdkSessionId ?? "session-1",
		repositoryId: overrides.repositoryId ?? "repo-a",
		title: overrides.title ?? "Session 1",
		model: overrides.model ?? "gpt-5.5",
		lastActive: overrides.lastActive ?? 100,
		cwd: overrides.cwd ?? "/repos/repo-a",
		lifecycleStatus: overrides.lifecycleStatus ?? "open",
		runStatus: overrides.runStatus ?? "idle",
		createdAt: overrides.createdAt ?? 50,
		source: overrides.source ?? "code",
		tag: overrides.tag ?? "code",
	};
}

describe("coding session refresh", () => {
	beforeEach(() => {
		useCodingStore.setState({
			appMode: "code",
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
			trashedSessions: [],
			trashedNextCursor: undefined,
			trashedSearchState: undefined,
			trashedSessionsLoaded: false,
			repositoriesLoaded: false,
			codingModels: [],
			codingModelsLoaded: false,
			selectedModelId: undefined,
			selectedEffort: undefined,
			fastTierEnabled: false,
		});
	});

	test("keeps an opened tab when its session is archived externally", async () => {
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
				"repo-a": [session({ sdkSessionId: "session-1" })],
			},
		});

		await refreshLoadedCodingSessionState({
			store: useCodingStore.getState(),
			fetchSessionDetail: async () =>
				session({
					sdkSessionId: "session-1",
					title: "Archived elsewhere",
					lifecycleStatus: "archived",
					lastActive: 200,
				}),
			fetchSessionPage: async () => ({ sessions: [] }),
			warn: () => {},
		});

		const state = useCodingStore.getState();
		expect(state.sessionsByRepository["repo-a"]).toEqual([]);
		expect(state.archivedSessions).toMatchObject([
			{
				sdkSessionId: "session-1",
				title: "Archived elsewhere",
				lifecycleStatus: "archived",
			},
		]);
		expect(state.openTabs).toHaveLength(1);
		expect(state.openTabs[0]).toMatchObject({
			providerId: "codex",
			sdkSessionId: "session-1",
			title: "Archived elsewhere",
		});
		expect(state.focusedSession).toEqual({
			providerId: "codex",
			sdkSessionId: "session-1",
		});
	});

	test("refreshes loaded repository pages and open tab titles", async () => {
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
				"repo-a": [session({ sdkSessionId: "session-1", title: "Old title" })],
			},
		});

		await refreshLoadedCodingSessionState({
			store: useCodingStore.getState(),
			fetchSessionDetail: async () =>
				session({ sdkSessionId: "session-1", title: "Renamed elsewhere" }),
			fetchSessionPage: async () => ({
				sessions: [
					session({ sdkSessionId: "session-1", title: "Renamed elsewhere" }),
				],
			}),
			warn: () => {},
		});

		const state = useCodingStore.getState();
		expect(state.sessionsByRepository["repo-a"]?.[0]?.title).toBe(
			"Renamed elsewhere",
		);
		expect(state.openTabs[0]?.title).toBe("Renamed elsewhere");
	});

	test("running-only reconciliation refreshes only mutable session details from memory", async () => {
		const detailRequests: Array<{ providerId: string; sdkSessionId: string }> =
			[];
		useCodingStore.setState({
			focusedRepositoryId: "repo-a",
			focusedSession: { providerId: "codex", sdkSessionId: "session-1" },
			openTabs: [
				{
					providerId: "codex",
					sdkSessionId: "session-1",
					repositoryId: "repo-a",
					title: "Running title",
				},
				{
					providerId: "codex",
					sdkSessionId: "session-2",
					repositoryId: "repo-a",
					title: "Idle title",
				},
			],
			sessionsByRepository: {
				"repo-a": [
					session({
						sdkSessionId: "session-1",
						title: "Running title",
						runStatus: "running",
					}),
					session({
						sdkSessionId: "session-2",
						title: "Idle title",
						runStatus: "idle",
					}),
				],
			},
			searchByRepository: {
				"repo-a": {
					query: "running",
					sessions: [
						session({
							sdkSessionId: "session-1",
							title: "Duplicate running search hit",
							runStatus: "running",
						}),
					],
				},
			},
		});

		await refreshLoadedCodingSessionState({
			mode: "running",
			store: useCodingStore.getState(),
			fetchSessionDetail: async (providerId, sdkSessionId) => {
				detailRequests.push({ providerId, sdkSessionId });
				return session({
					providerId,
					sdkSessionId,
					title: "Finished title",
					runStatus: "idle",
					lastActive: 300,
				});
			},
			fetchSessionPage: async () => {
				throw new Error("running-only refresh should not reload pages");
			},
			warn: () => {},
		});

		expect(detailRequests).toEqual([
			{ providerId: "codex", sdkSessionId: "session-1" },
		]);
		const state = useCodingStore.getState();
		expect(state.sessionsByRepository["repo-a"]?.[0]).toMatchObject({
			sdkSessionId: "session-1",
			title: "Finished title",
			runStatus: "idle",
			lastActive: 300,
		});
		expect(state.sessionsByRepository["repo-a"]?.[1]).toMatchObject({
			sdkSessionId: "session-2",
			title: "Idle title",
			runStatus: "idle",
		});
		expect(state.openTabs.map((tab) => tab.title)).toEqual([
			"Finished title",
			"Idle title",
		]);
	});

	test("running-only reconciliation preserves the loaded session list order", async () => {
		useCodingStore.setState({
			focusedRepositoryId: "repo-a",
			focusedSession: { providerId: "codex", sdkSessionId: "session-1" },
			openTabs: [
				{
					providerId: "codex",
					sdkSessionId: "session-1",
					repositoryId: "repo-a",
					title: "Running title",
				},
				{
					providerId: "codex",
					sdkSessionId: "session-2",
					repositoryId: "repo-a",
					title: "Idle title",
				},
			],
			sessionsByRepository: {
				"repo-a": [
					session({
						sdkSessionId: "session-2",
						title: "Idle title",
						lastActive: 400,
						runStatus: "idle",
					}),
					session({
						sdkSessionId: "session-1",
						title: "Running title",
						runStatus: "running",
					}),
				],
			},
		});

		await refreshLoadedCodingSessionState({
			mode: "running",
			store: useCodingStore.getState(),
			fetchSessionDetail: async () =>
				session({
					sdkSessionId: "session-1",
					title: "Finished title",
					runStatus: "idle",
					lastActive: 300,
				}),
			fetchSessionPage: async () => {
				throw new Error("running-only refresh should not reload pages");
			},
			warn: () => {},
		});

		const sessions = useCodingStore.getState().sessionsByRepository["repo-a"];
		expect(sessions?.map((entry) => entry.sdkSessionId)).toEqual([
			"session-2",
			"session-1",
		]);
		expect(sessions?.[1]).toMatchObject({
			sdkSessionId: "session-1",
			title: "Finished title",
			runStatus: "idle",
			lastActive: 300,
		});
	});

	test("full reconciliation preserves last-active ordering with multiple open tabs", async () => {
		useCodingStore.setState({
			focusedRepositoryId: "repo-a",
			focusedSession: { providerId: "codex", sdkSessionId: "session-1" },
			openTabs: [
				{
					providerId: "codex",
					sdkSessionId: "session-2",
					repositoryId: "repo-a",
					title: "Newest tab",
				},
				{
					providerId: "codex",
					sdkSessionId: "session-1",
					repositoryId: "repo-a",
					title: "Older tab",
				},
			],
			sessionsByRepository: {
				"repo-a": [
					session({
						sdkSessionId: "session-2",
						title: "Newest",
						lastActive: 400,
					}),
					session({
						sdkSessionId: "session-1",
						title: "Older",
						lastActive: 100,
					}),
				],
			},
		});

		await refreshLoadedCodingSessionState({
			store: useCodingStore.getState(),
			fetchSessionDetail: async (_providerId, sdkSessionId) =>
				sdkSessionId === "session-2"
					? session({
							sdkSessionId: "session-2",
							title: "Newest detail",
							lastActive: 400,
						})
					: session({
							sdkSessionId: "session-1",
							title: "Older detail",
							lastActive: 100,
						}),
			fetchSessionPage: async () => ({
				sessions: [
					session({
						sdkSessionId: "session-2",
						title: "Newest",
						lastActive: 400,
					}),
					session({
						sdkSessionId: "session-1",
						title: "Older",
						lastActive: 100,
					}),
				],
			}),
			warn: () => {},
		});

		expect(
			useCodingStore
				.getState()
				.sessionsByRepository["repo-a"]?.map((entry) => entry.sdkSessionId),
		).toEqual(["session-2", "session-1"]);
	});

	test("does not refresh archived pages during reconcile polling", async () => {
		const requests: Array<Parameters<FetchCodingSessionPage>[0]> = [];
		useCodingStore.getState().setArchivedSessions([], undefined);

		await refreshLoadedCodingSessionState({
			store: useCodingStore.getState(),
			fetchSessionDetail: async () => {
				throw new Error("unexpected detail fetch");
			},
			fetchSessionPage: async (params) => {
				requests.push(params);
				return params.lifecycleStatus === "archived"
					? { sessions: [session({ lifecycleStatus: "archived" })] }
					: { sessions: [] };
			},
			warn: () => {},
		});

		expect(requests).toEqual([]);
		expect(useCodingStore.getState().archivedSessions).toEqual([]);
	});
});

type FetchCodingSessionPage = (params: {
	limit: number;
	cursor?: never;
	lifecycleStatus?: "open" | "archived";
	providerId?: string;
	query?: string;
	repositoryId?: string;
}) => Promise<BrowserCodingSessionPageResponse>;
