import { describe, expect, test } from "bun:test";
import {
	shouldFetchAgentTree,
	shouldFetchGitStatus,
} from "../../../src/frontend/browser/components/right-panel/right-panel-fetch-policy.ts";

describe("right panel fetch policy", () => {
	test("fetches the file tree on first files-tab open", () => {
		expect(
			shouldFetchAgentTree({
				activeAgentId: "agent-alpha",
				activeUpperTab: "files",
				loadedAgentId: null,
				loadedRevision: null,
				treeRevision: 0,
			}),
		).toBe(true);
	});

	test("does not refetch the file tree when re-entering files with the same agent and revision", () => {
		expect(
			shouldFetchAgentTree({
				activeAgentId: "agent-alpha",
				activeUpperTab: "files",
				loadedAgentId: "agent-alpha",
				loadedRevision: 2,
				treeRevision: 2,
			}),
		).toBe(false);
	});

	test("refetches the file tree when the active agent changes", () => {
		expect(
			shouldFetchAgentTree({
				activeAgentId: "agent-beta",
				activeUpperTab: "files",
				loadedAgentId: "agent-alpha",
				loadedRevision: 2,
				treeRevision: 2,
			}),
		).toBe(true);
	});

	test("refetches the file tree when its revision changes", () => {
		expect(
			shouldFetchAgentTree({
				activeAgentId: "agent-alpha",
				activeUpperTab: "files",
				loadedAgentId: "agent-alpha",
				loadedRevision: 2,
				treeRevision: 3,
			}),
		).toBe(true);
	});

	test("does not fetch the file tree while another tab is active", () => {
		expect(
			shouldFetchAgentTree({
				activeAgentId: "agent-alpha",
				activeUpperTab: "git",
				loadedAgentId: null,
				loadedRevision: null,
				treeRevision: 0,
			}),
		).toBe(false);
	});

	test("fetches git status on first git-tab open", () => {
		expect(
			shouldFetchGitStatus({
				activeUpperTab: "git",
				gitRevision: 0,
				loadedRevision: null,
			}),
		).toBe(true);
	});

	test("does not refetch git status when re-entering git with the same revision", () => {
		expect(
			shouldFetchGitStatus({
				activeUpperTab: "git",
				gitRevision: 4,
				loadedRevision: 4,
			}),
		).toBe(false);
	});

	test("refetches git status when the git revision changes", () => {
		expect(
			shouldFetchGitStatus({
				activeUpperTab: "git",
				gitRevision: 5,
				loadedRevision: 4,
			}),
		).toBe(true);
	});

	test("does not fetch git status while another tab is active", () => {
		expect(
			shouldFetchGitStatus({
				activeUpperTab: "files",
				gitRevision: 1,
				loadedRevision: null,
			}),
		).toBe(false);
	});
});
