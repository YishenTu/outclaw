import { describe, expect, test } from "bun:test";
import type {
	BrowserCodingRepositorySummary,
	BrowserCodingSessionSummary,
} from "../../../src/common/protocol.ts";
import {
	ArchivedSessionsItem,
	createArchivedLoadMoreRequestKey,
	resolveArchivedSearchSubmission,
	shouldObserveArchivedLoadMore,
	shouldRequestObservedArchivedLoadMore,
} from "../../../src/frontend/browser/coding/archived-sessions-item.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

function session(
	overrides: Partial<BrowserCodingSessionSummary>,
): BrowserCodingSessionSummary {
	return {
		providerId: overrides.providerId ?? "codex",
		sdkSessionId: overrides.sdkSessionId ?? "sdk-archived",
		repositoryId: overrides.repositoryId ?? "repo-1",
		title: overrides.title ?? "Archived work",
		model: overrides.model ?? "model",
		lastActive: overrides.lastActive ?? Date.now() - 60_000,
		cwd: overrides.cwd ?? "/tmp",
		lifecycleStatus: overrides.lifecycleStatus ?? "archived",
		runStatus: overrides.runStatus ?? "idle",
		createdAt: overrides.createdAt ?? Date.now() - 120_000,
		source: overrides.source ?? "agent",
		tag: overrides.tag ?? "code",
	};
}

const NOOP = () => {};

function buttonOpeningTagWithLabel(html: string, label: string): string {
	const labelIndex = html.indexOf(`aria-label="${label}"`);
	expect(labelIndex).toBeGreaterThan(-1);
	const buttonStart = html.lastIndexOf("<button", labelIndex);
	const buttonEnd = html.indexOf(">", labelIndex);
	expect(buttonStart).toBeGreaterThan(-1);
	expect(buttonEnd).toBeGreaterThan(labelIndex);
	return html.slice(buttonStart, buttonEnd);
}

function repository(
	overrides: Partial<BrowserCodingRepositorySummary>,
): BrowserCodingRepositorySummary {
	return {
		id: overrides.id ?? "repo-1",
		rootCwd: overrides.rootCwd ?? "/tmp/outclaw",
		displayName: overrides.displayName ?? "Outclaw",
		source: overrides.source ?? "manual",
		status: overrides.status ?? "active",
		createdAt: overrides.createdAt ?? Date.now() - 240_000,
		lastActive: overrides.lastActive ?? Date.now() - 60_000,
		...(overrides.remoteUrl ? { remoteUrl: overrides.remoteUrl } : {}),
		...(overrides.archivedAt ? { archivedAt: overrides.archivedAt } : {}),
	};
}

describe("ArchivedSessionsItem", () => {
	test("renders a compact archive button that opens a dialog", () => {
		const archived = session({ title: "Archived work" });
		const html = renderToStaticMarkup(
			<ArchivedSessionsItem
				isOpen={false}
				repositories={[repository({})]}
				sessions={[archived]}
				onOpen={NOOP}
				onClose={NOOP}
				onSelectSession={NOOP}
				onRenameSession={NOOP}
				onRestoreSession={NOOP}
				onLoadMore={NOOP}
				onSearch={NOOP}
				onLoadMoreSearch={NOOP}
				onClearSearch={NOOP}
			/>,
		);

		expect(html).toContain(">Archive<");
		expect(html).toContain('aria-label="Open archived sessions"');
		expect(html).toContain('aria-haspopup="dialog"');
		expect(html).not.toContain('placeholder="Search archived sessions"');
		expect(html).not.toContain("Archived work");
	});

	test("renders archived sessions grouped by project inside the modal", () => {
		const archived = session({
			repositoryId: "repo-1",
			title: "Archived work",
		});
		const other = session({
			repositoryId: "repo-2",
			sdkSessionId: "sdk-archived-2",
			title: "Provider cleanup",
		});
		const html = renderToStaticMarkup(
			<ArchivedSessionsItem
				isOpen={true}
				repositories={[
					repository({ id: "repo-1", displayName: "Outclaw" }),
					repository({ id: "repo-2", displayName: "Claudian" }),
				]}
				sessions={[archived, other]}
				onOpen={NOOP}
				onClose={NOOP}
				onSelectSession={NOOP}
				onRenameSession={NOOP}
				onRestoreSession={NOOP}
				onLoadMore={NOOP}
				onSearch={NOOP}
				onLoadMoreSearch={NOOP}
				onClearSearch={NOOP}
			/>,
		);

		expect(html).toContain('role="dialog"');
		expect(html).toContain('placeholder="Search archived sessions"');
		expect(html).toContain("Outclaw");
		expect(html).toContain("Claudian");
		expect(html).toContain("Archived work");
		expect(html).toContain("Provider cleanup");
		expect(html).toContain('aria-label="Restore session Archived work"');
		expect(
			buttonOpeningTagWithLabel(html, "Restore session Archived work"),
		).not.toContain("hidden");
	});

	test("renders archived search results grouped by project in the modal", () => {
		const archived = session({ title: "Auth cleanup" });
		const html = renderToStaticMarkup(
			<ArchivedSessionsItem
				isOpen={true}
				repositories={[repository({})]}
				sessions={[]}
				searchState={{
					query: "auth",
					sessions: [archived],
					nextCursor: { lastActive: 1, sdkSessionId: "sdk-next" },
				}}
				onOpen={NOOP}
				onClose={NOOP}
				onSelectSession={NOOP}
				onRenameSession={NOOP}
				onRestoreSession={NOOP}
				onLoadMore={NOOP}
				onSearch={NOOP}
				onLoadMoreSearch={NOOP}
				onClearSearch={NOOP}
			/>,
		);

		expect(html).toContain("Auth cleanup");
		expect(html).toContain("Load more archived results");
	});

	test("observes archived search load more without repeating the same cursor", () => {
		const searchRequestKey = createArchivedLoadMoreRequestKey({
			cursor: { lastActive: 100, sdkSessionId: "sdk-next" },
			searchQuery: "auth",
		});
		const archiveRequestKey = createArchivedLoadMoreRequestKey({
			cursor: { lastActive: 100, sdkSessionId: "sdk-next" },
		});

		expect(
			shouldObserveArchivedLoadMore({
				hasNextCursor: true,
				intersectionObserverAvailable: true,
				isOpen: true,
			}),
		).toBe(true);
		expect(searchRequestKey).toBe("search:auth:100:sdk-next");
		expect(archiveRequestKey).toBe("archive:100:sdk-next");
		expect(
			shouldRequestObservedArchivedLoadMore({
				isIntersecting: true,
				lastRequestedKey: undefined,
				requestKey: searchRequestKey,
			}),
		).toBe(true);
		expect(
			shouldRequestObservedArchivedLoadMore({
				isIntersecting: true,
				lastRequestedKey: searchRequestKey,
				requestKey: searchRequestKey,
			}),
		).toBe(false);
	});

	test("does not resubmit the current archived search after load more renders", () => {
		expect(
			resolveArchivedSearchSubmission({
				currentSearchQuery: "auth",
				draftQuery: "auth",
				lastSubmittedQuery: "auth",
			}),
		).toEqual({ type: "none" });
		expect(
			resolveArchivedSearchSubmission({
				currentSearchQuery: "auth",
				draftQuery: "author",
				lastSubmittedQuery: "auth",
			}),
		).toEqual({ query: "author", type: "search" });
		expect(
			resolveArchivedSearchSubmission({
				currentSearchQuery: "auth",
				draftQuery: "",
				lastSubmittedQuery: "auth",
			}),
		).toEqual({ type: "clear" });
	});
});
