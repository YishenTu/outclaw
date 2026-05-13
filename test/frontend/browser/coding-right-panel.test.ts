import { describe, expect, test } from "bun:test";
import type { BrowserTreeEntry } from "../../../src/common/protocol.ts";
import {
	mergeTreeDirectoryChildren,
	shouldApplyCodingRepositoryDirectoryChildren,
	shouldLoadCodingRepositoryGitStatus,
	shouldLoadCodingRepositoryTree,
	treeDirectoryLoaded,
} from "../../../src/frontend/browser/coding/coding-right-panel.tsx";

describe("coding right panel state", () => {
	test("loads the repository file tree only while the files tab is visible", () => {
		expect(
			shouldLoadCodingRepositoryTree({
				activeTab: "files",
				focusedRepositoryId: "repo-1",
			}),
		).toBe(true);
		expect(
			shouldLoadCodingRepositoryTree({
				activeTab: "git",
				focusedRepositoryId: "repo-1",
			}),
		).toBe(false);
		expect(
			shouldLoadCodingRepositoryTree({
				activeTab: "files",
				focusedRepositoryId: undefined,
			}),
		).toBe(false);
	});

	test("loads repository git status only when the visible git panel is stale", () => {
		expect(
			shouldLoadCodingRepositoryGitStatus({
				activeTab: "git",
				focusedRepositoryId: "repo-1",
				gitRevision: 1,
				loadedGitRepositoryId: null,
				loadedGitRevision: null,
			}),
		).toBe(true);
		expect(
			shouldLoadCodingRepositoryGitStatus({
				activeTab: "files",
				focusedRepositoryId: "repo-1",
				gitRevision: 1,
				loadedGitRepositoryId: null,
				loadedGitRevision: null,
			}),
		).toBe(false);
		expect(
			shouldLoadCodingRepositoryGitStatus({
				activeTab: "git",
				focusedRepositoryId: undefined,
				gitRevision: 1,
				loadedGitRepositoryId: null,
				loadedGitRevision: null,
			}),
		).toBe(false);
		expect(
			shouldLoadCodingRepositoryGitStatus({
				activeTab: "git",
				focusedRepositoryId: "repo-1",
				gitRevision: 1,
				loadedGitRepositoryId: "repo-1",
				loadedGitRevision: 1,
			}),
		).toBe(false);
		expect(
			shouldLoadCodingRepositoryGitStatus({
				activeTab: "git",
				focusedRepositoryId: "repo-1",
				gitRevision: 2,
				loadedGitRepositoryId: "repo-1",
				loadedGitRevision: 1,
			}),
		).toBe(true);
		expect(
			shouldLoadCodingRepositoryGitStatus({
				activeTab: "git",
				focusedRepositoryId: "repo-2",
				gitRevision: 1,
				loadedGitRepositoryId: "repo-1",
				loadedGitRevision: 1,
			}),
		).toBe(true);
	});

	test("drops stale lazy directory responses after repository focus changes", () => {
		expect(
			shouldApplyCodingRepositoryDirectoryChildren({
				focusedRepositoryId: "repo-1",
				requestRepositoryId: "repo-1",
			}),
		).toBe(true);
		expect(
			shouldApplyCodingRepositoryDirectoryChildren({
				focusedRepositoryId: "repo-2",
				requestRepositoryId: "repo-1",
			}),
		).toBe(false);
		expect(
			shouldApplyCodingRepositoryDirectoryChildren({
				focusedRepositoryId: undefined,
				requestRepositoryId: "repo-1",
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
