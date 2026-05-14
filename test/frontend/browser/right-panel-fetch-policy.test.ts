import { describe, expect, test } from "bun:test";
import {
	shouldFetchAgentTree,
	shouldFetchGitStatus,
	shouldFetchInbox,
} from "../../../src/frontend/browser/components/right-panel/right-panel-fetch-policy.ts";

describe("right panel fetch policy", () => {
	test("fetches the file tree on first files-tab open", () => {
		expect(
			shouldFetchAgentTree({
				activeAgentId: "agent-alpha",
				activeUpperTab: "files",
				gitRevision: 0,
				loadedAgentId: null,
				loadedGitRevision: null,
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
				gitRevision: 4,
				loadedAgentId: "agent-alpha",
				loadedGitRevision: 4,
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
				gitRevision: 4,
				loadedAgentId: "agent-alpha",
				loadedGitRevision: 4,
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
				gitRevision: 4,
				loadedAgentId: "agent-alpha",
				loadedGitRevision: 4,
				loadedRevision: 2,
				treeRevision: 3,
			}),
		).toBe(true);
	});

	test("refetches the file tree when git status revision changes", () => {
		expect(
			shouldFetchAgentTree({
				activeAgentId: "agent-alpha",
				activeUpperTab: "files",
				gitRevision: 5,
				loadedAgentId: "agent-alpha",
				loadedGitRevision: 4,
				loadedRevision: 2,
				treeRevision: 2,
			}),
		).toBe(true);
	});

	test("does not fetch the file tree while another tab is active", () => {
		expect(
			shouldFetchAgentTree({
				activeAgentId: "agent-alpha",
				activeUpperTab: "git",
				gitRevision: 0,
				loadedAgentId: null,
				loadedGitRevision: null,
				loadedRevision: null,
				treeRevision: 0,
			}),
		).toBe(false);
	});

	test("fetches git status on first git-tab open", () => {
		expect(
			shouldFetchGitStatus({
				active: true,
				gitRevision: 0,
				scopeKey: null,
				loadedScopeKey: null,
				loadedRevision: null,
			}),
		).toBe(true);
	});

	test("does not refetch git status when re-entering git with the same revision", () => {
		expect(
			shouldFetchGitStatus({
				active: true,
				gitRevision: 4,
				scopeKey: null,
				loadedScopeKey: null,
				loadedRevision: 4,
			}),
		).toBe(false);
	});

	test("refetches git status when the git revision changes", () => {
		expect(
			shouldFetchGitStatus({
				active: true,
				gitRevision: 5,
				scopeKey: null,
				loadedScopeKey: null,
				loadedRevision: 4,
			}),
		).toBe(true);
	});

	test("does not fetch git status while another tab is active", () => {
		expect(
			shouldFetchGitStatus({
				active: false,
				gitRevision: 1,
				scopeKey: null,
				loadedScopeKey: null,
				loadedRevision: null,
			}),
		).toBe(false);
	});

	test("refetches git status when the workspace scope changes", () => {
		expect(
			shouldFetchGitStatus({
				active: true,
				gitRevision: 4,
				scopeKey: "/repo/packages/api",
				loadedScopeKey: "/repo/packages/app",
				loadedRevision: 4,
			}),
		).toBe(true);
		expect(
			shouldFetchGitStatus({
				active: true,
				gitRevision: 4,
				scopeKey: "/repo/packages/api",
				loadedScopeKey: "/repo/packages/api",
				loadedRevision: 4,
			}),
		).toBe(false);
	});

	test("fetches inbox data for badges from watcher-driven revision state", () => {
		expect(
			shouldFetchInbox({
				activeAgentId: "agent-alpha",
				inboxRevision: 0,
				loadedAgentId: null,
				loadedRevision: null,
			}),
		).toBe(true);
		expect(
			shouldFetchInbox({
				activeAgentId: "agent-alpha",
				inboxRevision: 2,
				loadedAgentId: "agent-alpha",
				loadedRevision: 2,
			}),
		).toBe(false);
		expect(
			shouldFetchInbox({
				activeAgentId: "agent-alpha",
				inboxRevision: 3,
				loadedAgentId: "agent-alpha",
				loadedRevision: 2,
			}),
		).toBe(true);
	});
});
