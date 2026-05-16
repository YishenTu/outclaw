import { beforeEach, describe, expect, test } from "bun:test";
import {
	resolveFocusedCodingRepository,
	resolveFocusedCodingSession,
} from "../../../src/frontend/browser/coding/coding-data.ts";
import {
	ActiveSessionPanel,
	CodingSessionView,
} from "../../../src/frontend/browser/coding/coding-session-view.tsx";
import {
	CODING_STORAGE_KEY,
	useCodingStore,
} from "../../../src/frontend/browser/coding/coding-store.ts";
import { CodingTabBar } from "../../../src/frontend/browser/coding/coding-tab-bar.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

describe("browser coding center", () => {
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
			repositoriesLoaded: false,
			codingModels: [],
			codingModelsLoaded: false,
			selectedModelId: undefined,
			selectedEffort: undefined,
			fastTierEnabled: false,
		});
		if (typeof globalThis.localStorage !== "undefined") {
			globalThis.localStorage.removeItem(CODING_STORAGE_KEY);
		}
	});

	test("keeps the code-mode tab strip at the same fixed height as chat mode", () => {
		const html = renderToStaticMarkup(
			<CodingTabBar
				tabs={[]}
				activeTabId={undefined}
				onSelect={() => {}}
				onClose={() => {}}
			/>,
		);

		expect(html).toContain(
			'class="flex h-12 shrink-0 items-stretch border-b border-dark-800 bg-dark-950 px-3"',
		);
	});

	test("lets the coding session body take remaining center-panel height", () => {
		const html = renderToStaticMarkup(
			<CodingSessionView
				repository={undefined}
				session={undefined}
				onSessionStarted={() => {}}
			/>,
		);

		expect(html).toContain('class="flex min-h-0 flex-1 flex-col bg-dark-950"');
		expect(html).not.toContain('class="flex h-full flex-col bg-dark-950"');
	});

	test("lets an active coding session fill linked middle-panel tabs", () => {
		const html = renderToStaticMarkup(
			<ActiveSessionPanel
				repository={{
					id: "repo-1",
					rootCwd: "/repo",
					displayName: "outclaw",
					source: "manual",
					status: "active",
					createdAt: 1,
					lastActive: 1,
				}}
				session={{
					providerId: "codex",
					sdkSessionId: "code-1",
					repositoryId: "repo-1",
					title: "Linked code task",
					model: "gpt-5.5",
					lastActive: 1,
					cwd: "/repo",
					lifecycleStatus: "open",
					runStatus: "idle",
					createdAt: 1,
					source: "code",
					tag: "code",
				}}
			/>,
		);

		expect(html).toContain(
			'class="flex h-full min-h-0 flex-1 flex-col bg-dark-950"',
		);
	});

	test("renders the coding composer as text-only because coding APIs do not accept images", () => {
		const html = renderToStaticMarkup(
			<CodingSessionView
				repository={{
					id: "repo-1",
					rootCwd: "/repo",
					displayName: "outclaw",
					source: "manual",
					status: "active",
					createdAt: 1,
					lastActive: 1,
				}}
				session={undefined}
				onSessionStarted={() => {}}
			/>,
		);

		expect(html).toContain('placeholder="Type a message..."');
		expect(html).not.toContain("paste/drop an image");
	});

	test("resolves a focused archived session and repository for middle-panel rendering", () => {
		const repositories = [
			{
				id: "repo-1",
				rootCwd: "/repo",
				displayName: "outclaw",
				source: "manual" as const,
				status: "archived" as const,
				createdAt: 1,
				lastActive: 1,
			},
		];
		const archivedSession = {
			providerId: "codex",
			sdkSessionId: "archived-session-1",
			repositoryId: "repo-1",
			title: "Archived work",
			model: "gpt-5.5",
			lastActive: 1,
			cwd: "/repo",
			lifecycleStatus: "archived" as const,
			runStatus: "idle" as const,
			createdAt: 1,
			source: "code",
			tag: "code" as const,
		};

		expect(resolveFocusedCodingRepository(repositories, "repo-1")).toEqual(
			repositories[0],
		);
		expect(
			resolveFocusedCodingSession({
				sessions: [],
				archivedSessions: [archivedSession],
				trashedSessions: [],
				focusedSession: {
					providerId: "codex",
					sdkSessionId: "archived-session-1",
				},
			}),
		).toEqual(archivedSession);
	});
});
