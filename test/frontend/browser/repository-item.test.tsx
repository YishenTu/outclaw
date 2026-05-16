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
const ACTIONS = {
	onToggle: NOOP,
	onSelectRepository: NOOP,
	onNewSession: NOOP,
	onArchiveRepository: NOOP,
	onTrashRepository: NOOP,
	onSelectSession: NOOP,
	onRenameSession: NOOP,
	onArchiveSession: NOOP,
	onTrashSession: NOOP,
	onLoadMore: NOOP,
	onSearch: NOOP,
	onLoadMoreSearch: NOOP,
	onClearSearch: NOOP,
};

function buttonOpeningTagWithLabel(html: string, label: string): string {
	const labelIndex = html.indexOf(`aria-label="${label}"`);
	expect(labelIndex).toBeGreaterThan(-1);
	const buttonStart = html.lastIndexOf("<button", labelIndex);
	const buttonEnd = html.indexOf(">", labelIndex);
	expect(buttonStart).toBeGreaterThan(-1);
	expect(buttonEnd).toBeGreaterThan(labelIndex);
	return html.slice(buttonStart, buttonEnd);
}

function repositoryToggleOpeningTag(html: string, label: string): string {
	const labelIndex = html.indexOf(label);
	expect(labelIndex).toBeGreaterThan(-1);
	const buttonStart = html.lastIndexOf("<button", labelIndex);
	const buttonEnd = html.indexOf(">", labelIndex);
	expect(buttonStart).toBeGreaterThan(-1);
	expect(buttonEnd).toBeGreaterThan(buttonStart);
	return html.slice(buttonStart, buttonEnd);
}

describe("RepositoryItem", () => {
	test("renders the repository row with a secondary actions trigger and plus affordance", () => {
		const html = renderToStaticMarkup(
			<RepositoryItem
				repository={REPOSITORY}
				isExpanded={false}
				sessions={[]}
				{...ACTIONS}
			/>,
		);
		expect(html).toContain("Outclaw");
		expect(html).toContain('aria-label="Open repository actions for Outclaw"');
		expect(html).toContain("lucide-ellipsis");
		expect(html).toContain('aria-label="Start new session in Outclaw"');
		expect(html).toContain("group-hover:pointer-events-auto");
		expect(html).toContain("group-hover:opacity-100");
		expect(html).toContain("absolute inset-y-0 right-2");
		expect(html).toContain('aria-expanded="false"');
		expect(html).not.toContain('aria-label="Search sessions for Outclaw"');
		expect(html).not.toContain('aria-label="Archive repository Outclaw"');
	});

	test("reserves row space so long repository names truncate before action buttons", () => {
		const longName =
			"Outclaw project with a very long display name that should never cover actions";
		const html = renderToStaticMarkup(
			<RepositoryItem
				repository={{ id: "repo-1", displayName: longName }}
				isExpanded={false}
				sessions={[]}
				{...ACTIONS}
			/>,
		);

		expect(repositoryToggleOpeningTag(html, longName)).toContain("pr-16");
		expect(html).toContain('aria-label="Open repository actions for ');
		expect(html).toContain('aria-label="Start new session in ');
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
				{...ACTIONS}
			/>,
		);
		expect(html).toContain("Active work");
		expect(html).toContain("Older work");
		expect(html).toContain('aria-label="Archive session Active work"');
		expect(html).toContain('aria-label="Archive session Older work"');
		expect(
			buttonOpeningTagWithLabel(html, "Archive session Active work"),
		).not.toContain('aria-haspopup="dialog"');
		expect(html).toContain("bg-dark-100");
	});

	test("falls back to the empty-state copy when expanded with no sessions", () => {
		const html = renderToStaticMarkup(
			<RepositoryItem
				repository={REPOSITORY}
				isExpanded={true}
				sessions={[]}
				{...ACTIONS}
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
				{...ACTIONS}
			/>,
		);
		expect(html).toContain('placeholder="Search sessions"');
		expect(html).toContain("Auth work");
		expect(html).toContain("Load more results");
		expect(html).toContain('aria-label="Open repository actions for Outclaw"');
		expect(html).not.toContain('aria-label="Close session search for Outclaw"');
	});
	test("does not render an inline archived-session subtree", () => {
		const html = renderToStaticMarkup(
			<RepositoryItem
				repository={REPOSITORY}
				isExpanded={true}
				sessions={[]}
				{...ACTIONS}
			/>,
		);
		expect(html).not.toContain("Archived sessions");
		expect(html).not.toContain('placeholder="Search archived sessions"');
	});
});
