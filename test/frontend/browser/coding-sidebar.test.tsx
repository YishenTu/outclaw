import { describe, expect, test } from "bun:test";
import type { BrowserCodingSessionSummary } from "../../../src/common/protocol.ts";
import {
	CodingSidebar,
	openCodingSidebarSessionFromList,
	shouldLoadArchivedSessionsOnOpen,
	startCodingSidebarSessionFromRepository,
} from "../../../src/frontend/browser/coding/coding-sidebar.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

const NOOP = () => {};

function session(): BrowserCodingSessionSummary {
	return {
		providerId: "codex",
		sdkSessionId: "sdk-1",
		repositoryId: "repo-1",
		title: "Fix mobile code mode",
		model: "gpt-5.5",
		lastActive: 1,
		cwd: "/repo",
		lifecycleStatus: "open",
		runStatus: "idle",
		createdAt: 1,
		source: "code",
		tag: "code",
	};
}

describe("CodingSidebar", () => {
	test("renders only add repo and archive in the fixed bottom action row", () => {
		const html = renderToStaticMarkup(
			<CodingSidebar
				repositories={[]}
				archivedRepositories={[]}
				trashedRepositories={[]}
				sessionsByRepository={{}}
				archivedSessions={[]}
				trashedSessions={[]}
				focusedRepositoryId={undefined}
				focusedSession={undefined}
				onSelectRepository={NOOP}
				onSelectSession={NOOP}
				onCreateRepository={NOOP}
			/>,
		);

		const addRepoIndex = html.indexOf(">Add repo<");
		const archiveIndex = html.indexOf(">Archive<");

		expect(html).toContain("grid shrink-0 grid-cols-2 border-t");
		expect(addRepoIndex).toBeGreaterThan(-1);
		expect(archiveIndex).toBeGreaterThan(addRepoIndex);
		expect(html).not.toContain(">Refresh<");
		expect(html).not.toContain(
			'aria-label="Refresh coding sessions from Codex"',
		);
		expect(html).not.toContain("Archived sessions");
	});

	test("activates the center panel after opening or creating a code session", () => {
		const calls: string[] = [];
		const selected = session();

		openCodingSidebarSessionFromList({
			repositoryId: "repo-1",
			session: selected,
			onSelectSession: (repositoryId, item) => {
				calls.push(`select:${repositoryId}:${item.sdkSessionId}`);
			},
			onActivateCenterPanel: () => calls.push("center"),
		});

		startCodingSidebarSessionFromRepository({
			repositoryId: "repo-1",
			onNewSession: (repositoryId) => calls.push(`new:${repositoryId}`),
			onActivateCenterPanel: () => calls.push("center"),
		});

		expect(calls).toEqual([
			"select:repo-1:sdk-1",
			"center",
			"new:repo-1",
			"center",
		]);
	});

	test("loads archived sessions only until the archive page has been loaded once", () => {
		expect(
			shouldLoadArchivedSessionsOnOpen({ archivedSessionsLoaded: false }),
		).toBe(true);
		expect(
			shouldLoadArchivedSessionsOnOpen({ archivedSessionsLoaded: true }),
		).toBe(false);
	});
});
