import { beforeEach, describe, expect, test } from "bun:test";
import type {
	BrowserCodingSessionPageResponse,
	BrowserCodingSessionSummary,
} from "../../../src/common/protocol.ts";
import {
	CODING_SESSION_RECONCILE_INTERVAL_MS,
	refreshLoadedCodingSessionState,
} from "../../../src/frontend/browser/coding/coding-session-refresh.ts";
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
			repositoriesLoaded: false,
			codingModels: [],
			codingModelsLoaded: false,
			selectedModelId: undefined,
			selectedEffort: undefined,
			fastTierEnabled: false,
		});
	});

	test("uses a short reconcile polling interval", () => {
		expect(CODING_SESSION_RECONCILE_INTERVAL_MS).toBe(5_000);
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
