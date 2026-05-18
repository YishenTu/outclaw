import { describe, expect, test } from "bun:test";
import type {
	BrowserCodingRepositorySummary,
	BrowserCodingSessionSummary,
	BrowserTreeEntry,
} from "../../../src/common/protocol.ts";
import {
	mergeTreeDirectoryChildren,
	resolveCodingRightPanelWorkspaceTarget,
	shouldApplyCodingRepositoryDirectoryChildren,
	shouldEnableCodingRunCommand,
	shouldLoadCodingRepositoryGitStatus,
	shouldLoadCodingRepositoryTree,
	treeDirectoryLoaded,
} from "../../../src/frontend/browser/coding/coding-right-panel.tsx";

const TEST_REPOSITORY: BrowserCodingRepositorySummary = {
	id: "repo-1",
	rootCwd: "/repo",
	displayName: "Repo",
	source: "manual",
	status: "active",
	createdAt: 1,
	lastActive: 1,
};

function codingSession(
	overrides: Partial<BrowserCodingSessionSummary>,
): BrowserCodingSessionSummary {
	return {
		providerId: "codex",
		sdkSessionId: "session-1",
		repositoryId: "repo-1",
		title: "Session",
		model: "gpt-5.5",
		lastActive: 1,
		cwd: "/repo/packages/app",
		lifecycleStatus: "open",
		runStatus: "idle",
		createdAt: 1,
		source: "code",
		tag: "code",
		...overrides,
	};
}

describe("coding right panel state", () => {
	test("enables the run command button for a focused coding repository", () => {
		expect(
			shouldEnableCodingRunCommand({
				saving: false,
				workspaceKey: "/repo",
			}),
		).toBe(true);
		expect(
			shouldEnableCodingRunCommand({
				saving: true,
				workspaceKey: "/repo",
			}),
		).toBe(false);
		expect(
			shouldEnableCodingRunCommand({
				saving: false,
				workspaceKey: undefined,
			}),
		).toBe(false);
	});

	test("targets the focused coding session workspace when one is selected", () => {
		const sessions = [
			codingSession({
				sdkSessionId: "session-1",
				title: "Session 1",
			}),
			codingSession({
				sdkSessionId: "session-2",
				title: "Session 2",
				lastActive: 2,
				createdAt: 2,
			}),
		];
		const sessionOneTarget = resolveCodingRightPanelWorkspaceTarget({
			focusedRepositoryId: "repo-1",
			focusedSession: {
				providerId: "codex",
				sdkSessionId: "session-1",
			},
			repository: TEST_REPOSITORY,
			sessions,
		});

		const sessionTwoTarget = resolveCodingRightPanelWorkspaceTarget({
			focusedRepositoryId: "repo-1",
			focusedSession: {
				providerId: "codex",
				sdkSessionId: "session-2",
			},
			repository: TEST_REPOSITORY,
			sessions,
		});

		expect(sessionOneTarget).toEqual({
			providerId: "codex",
			repositoryId: "repo-1",
			sdkSessionId: "session-1",
			workspaceCwd: "/repo/packages/app",
			workspaceKey: "/repo/packages/app",
		});
		expect(sessionTwoTarget).toEqual({
			providerId: "codex",
			repositoryId: "repo-1",
			sdkSessionId: "session-2",
			workspaceCwd: "/repo/packages/app",
			workspaceKey: "/repo/packages/app",
		});
		expect(sessionTwoTarget?.workspaceKey).toBe(sessionOneTarget?.workspaceKey);
		expect(
			resolveCodingRightPanelWorkspaceTarget({
				focusedRepositoryId: "repo-1",
				focusedSession: {
					providerId: "__file__",
					sdkSessionId: "src/index.ts",
				},
				repository: TEST_REPOSITORY,
				sessions: [],
			}),
		).toEqual({
			repositoryId: "repo-1",
			workspaceCwd: "/repo",
			workspaceKey: "/repo",
		});
		expect(
			resolveCodingRightPanelWorkspaceTarget({
				focusedRepositoryId: "repo-1",
				focusedSession: {
					providerId: "codex",
					sdkSessionId: "missing-session",
				},
				repository: TEST_REPOSITORY,
				repositorySessionsLoaded: false,
				sessions: [],
			}),
		).toBeUndefined();
	});

	test("targets the repository root when a repo has no coding sessions yet", () => {
		expect(
			resolveCodingRightPanelWorkspaceTarget({
				focusedRepositoryId: "repo-1",
				focusedSession: {
					providerId: "codex",
					sdkSessionId: "missing-session",
				},
				repository: TEST_REPOSITORY,
				repositorySessionsLoaded: true,
				sessions: [],
			}),
		).toEqual({
			repositoryId: "repo-1",
			workspaceCwd: "/repo",
			workspaceKey: "/repo",
		});
	});

	test("loads the repository file tree only while the files tab is visible", () => {
		expect(
			shouldLoadCodingRepositoryTree({
				activeTab: "files",
				focusedWorkspaceKey: "repo-1",
				gitRevision: 1,
				loadedTreeGitRevision: null,
				loadedTreeWorkspaceKey: null,
			}),
		).toBe(true);
		expect(
			shouldLoadCodingRepositoryTree({
				activeTab: "git",
				focusedWorkspaceKey: "repo-1",
				gitRevision: 1,
				loadedTreeGitRevision: null,
				loadedTreeWorkspaceKey: null,
			}),
		).toBe(false);
		expect(
			shouldLoadCodingRepositoryTree({
				activeTab: "files",
				focusedWorkspaceKey: undefined,
				gitRevision: 1,
				loadedTreeGitRevision: null,
				loadedTreeWorkspaceKey: null,
			}),
		).toBe(false);
		expect(
			shouldLoadCodingRepositoryTree({
				activeTab: "files",
				focusedWorkspaceKey: "repo-1",
				gitRevision: 1,
				loadedTreeGitRevision: 1,
				loadedTreeWorkspaceKey: "repo-1",
			}),
		).toBe(false);
		expect(
			shouldLoadCodingRepositoryTree({
				activeTab: "files",
				focusedWorkspaceKey: "repo-1",
				gitRevision: 2,
				loadedTreeGitRevision: 1,
				loadedTreeWorkspaceKey: "repo-1",
			}),
		).toBe(true);
		expect(
			shouldLoadCodingRepositoryTree({
				activeTab: "files",
				focusedWorkspaceKey: "repo-2",
				gitRevision: 1,
				loadedTreeGitRevision: 1,
				loadedTreeWorkspaceKey: "repo-1",
			}),
		).toBe(true);
	});

	test("loads repository git status only when the visible git workspace is stale", () => {
		expect(
			shouldLoadCodingRepositoryGitStatus({
				activeTab: "git",
				focusedWorkspaceKey: "repo-1",
				gitRevision: 1,
				loadedGitWorkspaceKey: null,
				loadedGitRevision: null,
			}),
		).toBe(true);
		expect(
			shouldLoadCodingRepositoryGitStatus({
				activeTab: "files",
				focusedWorkspaceKey: "repo-1",
				gitRevision: 1,
				loadedGitWorkspaceKey: null,
				loadedGitRevision: null,
			}),
		).toBe(false);
		expect(
			shouldLoadCodingRepositoryGitStatus({
				activeTab: "git",
				focusedWorkspaceKey: undefined,
				gitRevision: 1,
				loadedGitWorkspaceKey: null,
				loadedGitRevision: null,
			}),
		).toBe(false);
		expect(
			shouldLoadCodingRepositoryGitStatus({
				activeTab: "git",
				focusedWorkspaceKey: "repo-1",
				gitRevision: 1,
				loadedGitWorkspaceKey: "repo-1",
				loadedGitRevision: 1,
			}),
		).toBe(false);
		expect(
			shouldLoadCodingRepositoryGitStatus({
				activeTab: "git",
				focusedWorkspaceKey: "repo-1",
				gitRevision: 2,
				loadedGitWorkspaceKey: "repo-1",
				loadedGitRevision: 1,
			}),
		).toBe(true);
		expect(
			shouldLoadCodingRepositoryGitStatus({
				activeTab: "git",
				focusedWorkspaceKey: "/repo/packages/app",
				gitRevision: 1,
				loadedGitWorkspaceKey: "/repo/packages/app",
				loadedGitRevision: 1,
			}),
		).toBe(false);
	});

	test("drops stale lazy directory responses after workspace cwd changes", () => {
		expect(
			shouldApplyCodingRepositoryDirectoryChildren({
				focusedWorkspaceKey: "repo-1:codex/session-1",
				requestWorkspaceKey: "repo-1:codex/session-1",
			}),
		).toBe(true);
		expect(
			shouldApplyCodingRepositoryDirectoryChildren({
				focusedWorkspaceKey: "repo-1:codex/session-2",
				requestWorkspaceKey: "repo-1:codex/session-1",
			}),
		).toBe(false);
		expect(
			shouldApplyCodingRepositoryDirectoryChildren({
				focusedWorkspaceKey: undefined,
				requestWorkspaceKey: "repo-1:codex/session-1",
			}),
		).toBe(false);
	});

	test("tracks whether a directory's lazy children are loaded", () => {
		const entries: BrowserTreeEntry[] = [
			{
				kind: "directory",
				name: "src",
				path: "src",
			},
			{
				kind: "directory",
				name: "empty",
				path: "empty",
				children: [],
			},
		];

		expect(treeDirectoryLoaded(entries, "src")).toBe(false);
		expect(treeDirectoryLoaded(entries, "empty")).toBe(true);
	});

	test("merges lazily fetched children into an existing directory", () => {
		const entries: BrowserTreeEntry[] = [
			{
				kind: "directory",
				name: "src",
				path: "src",
				children: [
					{
						kind: "directory",
						name: "feature",
						path: "src/feature",
					},
				],
			},
		];

		const next = mergeTreeDirectoryChildren(entries, "src/feature", [
			{
				kind: "file",
				name: "view.ts",
				path: "src/feature/view.ts",
			},
		]);

		expect(next).toEqual([
			{
				kind: "directory",
				name: "src",
				path: "src",
				children: [
					{
						kind: "directory",
						name: "feature",
						path: "src/feature",
						children: [
							{
								kind: "file",
								name: "view.ts",
								path: "src/feature/view.ts",
							},
						],
					},
				],
			},
		]);
		expect(entries[0]?.kind === "directory" ? entries[0].children : []).toEqual(
			[
				{
					kind: "directory",
					name: "feature",
					path: "src/feature",
				},
			],
		);
	});
});
