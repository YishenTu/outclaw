import { describe, expect, test } from "bun:test";
import { InboxPanel } from "../../../src/frontend/browser/components/right-panel/inbox-panel.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

describe("InboxPanel", () => {
	test("renders pending inbox items, collapsed archive, and undo action", () => {
		const html = renderToStaticMarkup(
			<InboxPanel
				agentId="agent-railly"
				agentName="railly"
				error={null}
				inbox={{
					archivedItems: [
						{
							location: "archive",
							modifiedAt: "2026-04-01T00:00:00.000Z",
							name: "done.md",
							path: "inbox/archive/done.md",
							size: 4,
						},
						{
							location: "archive",
							modifiedAt: "2026-04-01T00:00:00.000Z",
							name: "later.md",
							path: "inbox/archive/later.md",
							size: 4,
						},
					],
					items: [
						{
							location: "inbox",
							modifiedAt: "2026-04-02T00:00:00.000Z",
							name: "todo.md",
							path: "inbox/todo.md",
							size: 4,
						},
					],
					pendingCount: 1,
				}}
				loading={false}
				onArchive={() => {}}
				onCreateNote={async () => {}}
				onOpenFile={() => {}}
				onUndoArchive={() => {}}
				undoArchive={{
					archivedPath: "inbox/archive/todo.md",
					expiresAtMs: Date.now() + 10_000,
					name: "todo.md",
					originalPath: "inbox/todo.md",
				}}
			/>,
		);

		expect(html).toContain("~/.outclaw/agents/railly/inbox");
		expect(html).toContain('aria-label="Add inbox note"');
		expect(html).toContain("lucide-plus");
		expect(html).toContain(">Pending<");
		expect(html).toContain(">todo.md<");
		expect(html).toContain('aria-label="Archive todo.md"');
		expect(html).not.toContain(">4 B<");
		expect(html).toContain(">Archive<");
		expect(html).toContain("shrink-0 border-t border-dark-800 px-3 py-2");
		expect(html).not.toContain(">2<");
		expect(html).toContain('aria-expanded="false"');
		expect(html).not.toContain(">done.md<");
		expect(html).toContain(">Undo<");
		expect(html).toContain("rounded-full border border-dark-700 bg-dark-900");
		expect(html).not.toContain("lucide-rotate-ccw");
	});

	test("renders archive items when the archive area is expanded", () => {
		const html = renderToStaticMarkup(
			<InboxPanel
				agentId="agent-railly"
				agentName="railly"
				defaultArchiveExpanded
				error={null}
				inbox={{
					archivedItems: [
						{
							location: "archive",
							modifiedAt: "2026-04-01T00:00:00.000Z",
							name: "done.md",
							path: "inbox/archive/done.md",
							size: 4,
						},
					],
					items: [],
					pendingCount: 0,
				}}
				loading={false}
				onArchive={() => {}}
				onCreateNote={async () => {}}
				onOpenFile={() => {}}
				onUndoArchive={() => {}}
				undoArchive={null}
			/>,
		);

		expect(html).toContain('aria-expanded="true"');
		expect(html).toContain("scrollbar-none max-h-64 overflow-y-auto");
		expect(html).toContain(">done.md<");
		expect(html).not.toContain(">4 B<");
	});

	test("renders the inline note composer from the header add action", () => {
		const html = renderToStaticMarkup(
			<InboxPanel
				agentId="agent-railly"
				agentName="railly"
				defaultNoteComposerOpen
				error={null}
				inbox={{
					archivedItems: [],
					items: [],
					pendingCount: 0,
				}}
				loading={false}
				onArchive={() => {}}
				onCreateNote={async () => {}}
				onOpenFile={() => {}}
				onUndoArchive={() => {}}
				undoArchive={null}
			/>,
		);

		expect(html).toContain('placeholder="Title"');
		expect(html).toContain('placeholder="Note"');
		expect(html).toContain(">Save<");
		expect(html).toContain(">Cancel<");
		expect(html).not.toContain("font-mono-ui text-[11px] text-dark-500");
	});

	test("does not render expired undo actions", () => {
		const html = renderToStaticMarkup(
			<InboxPanel
				agentId="agent-railly"
				agentName="railly"
				error={null}
				inbox={{
					archivedItems: [],
					items: [],
					pendingCount: 0,
				}}
				loading={false}
				onArchive={() => {}}
				onCreateNote={async () => {}}
				onOpenFile={() => {}}
				onUndoArchive={() => {}}
				undoArchive={{
					archivedPath: "inbox/archive/todo.md",
					expiresAtMs: 0,
					name: "todo.md",
					originalPath: "inbox/todo.md",
				}}
			/>,
		);

		expect(html).not.toContain(">Undo<");
		expect(html).not.toContain("Archived todo.md");
	});
});
