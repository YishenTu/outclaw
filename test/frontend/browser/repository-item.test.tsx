import { describe, expect, test } from "bun:test";
import type { BrowserCodingSessionSummary } from "../../../src/common/protocol.ts";
import { RepositoryItem } from "../../../src/frontend/browser/coding/repository-item.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

function session(
	overrides: Partial<BrowserCodingSessionSummary>,
): BrowserCodingSessionSummary {
	return {
		providerId: overrides.providerId ?? "codex",
		sdkSessionId: overrides.sdkSessionId ?? "sdk-1",
		repositoryId: overrides.repositoryId ?? "repo-1",
		title: overrides.title ?? "First session",
		model: overrides.model ?? "model",
		lastActive: overrides.lastActive ?? Date.now() - 60_000,
		cwd: overrides.cwd ?? "/tmp",
		lifecycleStatus: overrides.lifecycleStatus ?? "open",
		runStatus: overrides.runStatus ?? "idle",
		createdAt: overrides.createdAt ?? Date.now() - 120_000,
		source: overrides.source ?? "agent",
		tag: overrides.tag ?? "code",
	};
}

const REPOSITORY = { id: "repo-1", displayName: "Outclaw" };
const NOOP = () => {};

describe("RepositoryItem", () => {
	test("renders the repository row with chevron, search and plus affordances", () => {
		const html = renderToStaticMarkup(
			<RepositoryItem
				repository={REPOSITORY}
				isExpanded={false}
				sessions={[]}
				onToggle={NOOP}
				onSelectRepository={NOOP}
				onNewSession={NOOP}
				onSelectSession={NOOP}
				onRenameSession={NOOP}
				onDeleteSession={NOOP}
				onLoadMore={NOOP}
				onSearch={NOOP}
				onLoadMoreSearch={NOOP}
				onClearSearch={NOOP}
			/>,
		);
		expect(html).toContain("Outclaw");
		expect(html).toContain('aria-label="Search sessions for Outclaw"');
		expect(html).toContain('aria-label="Start new session in Outclaw"');
		expect(html).toContain('aria-expanded="false"');
	});

	test("renders sessions with the shared SessionItem when expanded and marks active", () => {
		const focused = session({
			sdkSessionId: "sdk-active",
			title: "Active work",
		});
		const other = session({
			sdkSessionId: "sdk-other",
			title: "Older work",
		});
		const html = renderToStaticMarkup(
			<RepositoryItem
				repository={REPOSITORY}
				isExpanded={true}
				focusedSession={{
					providerId: focused.providerId,
					sdkSessionId: focused.sdkSessionId,
				}}
				sessions={[focused, other]}
				onToggle={NOOP}
				onSelectRepository={NOOP}
				onNewSession={NOOP}
				onSelectSession={NOOP}
				onRenameSession={NOOP}
				onDeleteSession={NOOP}
				onLoadMore={NOOP}
				onSearch={NOOP}
				onLoadMoreSearch={NOOP}
				onClearSearch={NOOP}
			/>,
		);
		expect(html).toContain("Active work");
		expect(html).toContain("Older work");
		expect(html).toContain('aria-label="Delete session Active work"');
		expect(html).toContain('aria-label="Delete session Older work"');
		expect(html).toContain("bg-dark-100");
	});

	test("falls back to the empty-state copy when expanded with no sessions", () => {
		const html = renderToStaticMarkup(
			<RepositoryItem
				repository={REPOSITORY}
				isExpanded={true}
				sessions={[]}
				onToggle={NOOP}
				onSelectRepository={NOOP}
				onNewSession={NOOP}
				onSelectSession={NOOP}
				onRenameSession={NOOP}
				onDeleteSession={NOOP}
				onLoadMore={NOOP}
				onSearch={NOOP}
				onLoadMoreSearch={NOOP}
				onClearSearch={NOOP}
			/>,
		);
		expect(html).toContain("No sessions yet for this project.");
	});

	test("renders the search input and load-more affordance when search state is provided", () => {
		const match = session({ title: "Auth work" });
		const html = renderToStaticMarkup(
			<RepositoryItem
				repository={REPOSITORY}
				isExpanded={true}
				sessions={[]}
				searchState={{
					query: "auth",
					sessions: [match],
					nextCursor: { lastActive: 1, sdkSessionId: "sdk-next" },
				}}
				onToggle={NOOP}
				onSelectRepository={NOOP}
				onNewSession={NOOP}
				onSelectSession={NOOP}
				onRenameSession={NOOP}
				onDeleteSession={NOOP}
				onLoadMore={NOOP}
				onSearch={NOOP}
				onLoadMoreSearch={NOOP}
				onClearSearch={NOOP}
			/>,
		);
		expect(html).toContain('placeholder="Search sessions"');
		expect(html).toContain("Auth work");
		expect(html).toContain("Load more results");
		expect(html).toContain('aria-label="Close session search for Outclaw"');
	});
});
