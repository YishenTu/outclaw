import { describe, expect, test } from "bun:test";
import type { BrowserTreeEntry } from "../../../src/common/protocol.ts";
import {
	browserTreeEntriesEqual,
	resolveTreeRefreshFailure,
	shouldShowTreeLoading,
} from "../../../src/frontend/browser/components/right-panel/tree-refresh-policy.ts";

const TREE: BrowserTreeEntry[] = [
	{ kind: "file", name: "AGENTS.md", path: "AGENTS.md" },
];

describe("tree refresh policy", () => {
	test("shows loading only before a tree has rendered", () => {
		expect(shouldShowTreeLoading({ entries: [], loading: true })).toBe(true);
		expect(shouldShowTreeLoading({ entries: TREE, loading: true })).toBe(false);
		expect(shouldShowTreeLoading({ entries: [], loading: false })).toBe(false);
	});

	test("keeps an existing tree visible when a background refresh fails", () => {
		expect(
			resolveTreeRefreshFailure({
				currentTree: TREE,
				errorMessage: "Failed to load file tree",
			}),
		).toEqual({
			tree: TREE,
			treeError: null,
		});
	});

	test("surfaces initial load errors when there is no tree to keep visible", () => {
		expect(
			resolveTreeRefreshFailure({
				currentTree: [],
				errorMessage: "Failed to load file tree",
			}),
		).toEqual({
			tree: [],
			treeError: "Failed to load file tree",
		});
	});

	test("compares tree entries by visible structure and status", () => {
		expect(
			browserTreeEntriesEqual(TREE, [
				{ kind: "file", name: "AGENTS.md", path: "AGENTS.md" },
			]),
		).toBe(true);
		expect(
			browserTreeEntriesEqual(TREE, [
				{
					kind: "file",
					name: "AGENTS.md",
					path: "AGENTS.md",
					gitStatus: "modified",
				},
			]),
		).toBe(false);
		expect(
			browserTreeEntriesEqual(
				[
					{
						kind: "directory",
						name: "src",
						path: "src",
						children: TREE,
					},
				],
				[
					{
						kind: "directory",
						name: "src",
						path: "src",
						children: TREE,
					},
				],
			),
		).toBe(true);
	});
});
