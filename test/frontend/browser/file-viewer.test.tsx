import { describe, expect, test } from "bun:test";
import { isValidElement, type ReactNode } from "react";
import type { BrowserFileResponse } from "../../../src/common/protocol.ts";
import {
	diffFileLineStatus,
	type EditableSourceEditorProps,
	EditableSourceToolbar,
	EditableSourceView,
	mergeFileLineStatus,
} from "../../../src/frontend/browser/components/file-viewer/editable-source-view.tsx";
import {
	CodePreview,
	defaultFilePreviewMode,
	FilePreviewContent,
	FilePreviewHeader,
	type FilePreviewMode,
	FileViewer,
	MarkdownPreview,
	resolveFilePreviewReloadTrigger,
	resolveFilePreviewScrollRestoreTrigger,
	resolveGitLineStatusDiffPath,
} from "../../../src/frontend/browser/components/file-viewer/file-viewer.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

type ButtonElementProps = {
	children?: ReactNode;
	onClick?: () => void;
};

function textContent(node: ReactNode): string {
	if (typeof node === "string" || typeof node === "number") {
		return String(node);
	}
	if (!node || typeof node === "boolean") {
		return "";
	}
	if (Array.isArray(node)) {
		return node.map(textContent).join("");
	}
	if (isValidElement(node)) {
		return textContent((node.props as { children?: ReactNode }).children);
	}
	return "";
}

function findButtonByLabel(
	node: ReactNode,
	label: string,
): ButtonElementProps | null {
	if (!node || typeof node === "boolean") {
		return null;
	}
	if (Array.isArray(node)) {
		for (const child of node) {
			const match = findButtonByLabel(child, label);
			if (match) {
				return match;
			}
		}
		return null;
	}
	if (!isValidElement(node)) {
		return null;
	}

	const props = node.props as ButtonElementProps;
	if (node.type === "button" && textContent(props.children) === label) {
		return props;
	}
	return findButtonByLabel(props.children, label);
}

function expectButtonDisabled(html: string, label: string, disabled: boolean) {
	const button = html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0];
	const attributes = button?.match(/^<button\b([^>]*)>/)?.[1] ?? "";

	expect(button).toBeDefined();
	if (disabled) {
		expect(attributes).toMatch(/\sdisabled(?:=""|(?=\s|$))/);
	} else {
		expect(attributes).not.toMatch(/\sdisabled(?:=""|(?=\s|$))/);
	}
}

function textFile(
	path: string,
	content: string,
	overrides: Partial<BrowserFileResponse> = {},
): BrowserFileResponse {
	return {
		path,
		kind: "text",
		content,
		language: undefined,
		mtimeMs: 1,
		sha256: "sha",
		truncated: false,
		...overrides,
	};
}

describe("CodePreview", () => {
	test("renders YAML with syntax highlighting", () => {
		const html = renderToStaticMarkup(
			<CodePreview content={"name: Daily\nenabled: true\n"} language="yaml" />,
		);

		expect(html).toContain("language-yaml");
		expect(html).toContain("hljs-attr");
		expect(html).toContain("hljs-literal");
	});

	test("escapes content when no supported language is provided", () => {
		const html = renderToStaticMarkup(
			<CodePreview
				content={"<script>alert('x')</script>"}
				language={undefined}
			/>,
		);

		expect(html).toContain("&lt;script&gt;");
		expect(html).not.toContain("<script>");
	});
});

describe("MarkdownPreview", () => {
	test("renders HTML comments as visible comment annotations", () => {
		const html = renderToStaticMarkup(
			<MarkdownPreview
				content={"# Title\n\n<!-- hint for editors -->\n\nBody\n"}
			/>,
		);

		expect(html).toContain("md-comment");
		expect(html).toContain("hint for editors");
		expect(html).toContain("<h1>Title</h1>");
		expect(html).toContain("Body");
	});

	test("renders multi-line HTML comments preserving trimmed content", () => {
		const html = renderToStaticMarkup(
			<MarkdownPreview content={"<!-- line one\nline two -->\n\nafter\n"} />,
		);

		expect(html).toContain("md-comment");
		expect(html).toContain("line one");
		expect(html).toContain("line two");
	});

	test("renders ordinary markdown without introducing comment markers", () => {
		const html = renderToStaticMarkup(
			<MarkdownPreview content={"Just a paragraph.\n"} />,
		);

		expect(html).not.toContain("md-comment");
		expect(html).toContain("Just a paragraph.");
	});

	test("renders leading frontmatter as YAML preview before markdown body", () => {
		const html = renderToStaticMarkup(
			<MarkdownPreview
				content={
					"---\nname: daily-brief\nkind: topic\nlast_observation_at: 2026-04-21\nlast_synthesized: 2026-04-20\n---\n\n# Model\n\n## What\n\nBody\n"
				}
			/>,
		);

		expect(html).toContain("language-yaml");
		expect(html).toContain("daily-brief");
		expect(html).toContain("<hr");
		expect(html).toContain("<h1>Model</h1>");
		expect(html).toContain("<h2>What</h2>");
		expect(html).toContain("Body");
		expect(html).not.toContain("Frontmatter");
	});

	test("wraps fenced code blocks without horizontal scrolling", () => {
		const html = renderToStaticMarkup(
			<MarkdownPreview
				content={"```ts\nconst value = '0123456789'.repeat(40);\n```"}
			/>,
		);

		expect(html).toContain("[&amp;_pre]:overflow-x-hidden");
		expect(html).toContain("[&amp;_pre]:whitespace-pre-wrap");
		expect(html).toContain("[&amp;_pre]:[overflow-wrap:anywhere]");
		expect(html).toContain("[&amp;_pre_code]:whitespace-pre-wrap");
	});

	test("removes typography backticks from inline code", () => {
		const html = renderToStaticMarkup(
			<MarkdownPreview content={"Use `code` inline"} />,
		);

		expect(html).toContain("[&amp;_code::before]:content-none");
		expect(html).toContain("[&amp;_code::after]:content-none");
	});

	test("styles wikilinks in markdown body text", () => {
		const html = renderToStaticMarkup(
			<MarkdownPreview content={"See [[project-outclaw]] for context."} />,
		);

		expect(html).toContain(
			'<strong class="md-wikilink text-brand font-bold">project-outclaw</strong>',
		);
		expect(html).not.toContain(">[[project-outclaw]]</strong>");
	});

	test("leaves inline code wikilinks as plain code text", () => {
		const html = renderToStaticMarkup(
			<MarkdownPreview content={"Keep `[[project-outclaw]]` literal."} />,
		);

		expect(html).toContain("<code>[[project-outclaw]]</code>");
		expect(html).not.toContain("md-wikilink");
		expect(html).not.toContain("text-brand");
	});
});

describe("EditableSourceView", () => {
	const editorComponent = ({ content }: EditableSourceEditorProps) => (
		<textarea readOnly value={content} />
	);

	test("renders the source toolbar with saved state and save controls", () => {
		const html = renderToStaticMarkup(
			<EditableSourceView
				content="current"
				editorComponent={editorComponent}
				conflictNotice={false}
				onAcceptReload={() => {}}
				onDiscard={() => {}}
				onSave={async () => {}}
				saveError={null}
				saving={false}
			/>,
		);

		expect(html).toContain('data-dirty="false"');
		expect(html).toContain(">In sync<");
		expect(html).toContain(">Save<");
		expect(html).toContain(">Revert<");
		expectButtonDisabled(html, "Save", true);
		expectButtonDisabled(html, "Revert", true);
	});

	test("disables save and revert when content equals baseline and enables them when content differs", () => {
		const renderToolbar = (content: string, currentContent: string) =>
			renderToStaticMarkup(
				<EditableSourceToolbar
					dirty={currentContent !== content}
					onRevert={() => {}}
					onSave={() => {}}
					saving={false}
				/>,
			);

		const cleanHtml = renderToolbar("current", "current");
		const dirtyHtml = renderToolbar("current", "changed");

		expectButtonDisabled(cleanHtml, "Save", true);
		expectButtonDisabled(cleanHtml, "Revert", true);
		expectButtonDisabled(dirtyHtml, "Save", false);
		expectButtonDisabled(dirtyHtml, "Revert", false);
	});

	test("renders the conflict banner with reload-only resolution", () => {
		const html = renderToStaticMarkup(
			<EditableSourceView
				content="current"
				editorComponent={editorComponent}
				conflictNotice={true}
				onAcceptReload={() => {}}
				onDiscard={() => {}}
				onSave={async () => {}}
				saveError={null}
				saving={false}
			/>,
		);

		expect(html).toContain("File changed on disk.");
		expect(html).toContain(">Reload<");
		expect(html).not.toContain("Overwrite");
	});

	test("overlays in-memory edit line status onto loaded git status", () => {
		const editStatus = diffFileLineStatus("one\ntwo\n", "one\nchanged\n");
		const merged = mergeFileLineStatus(
			{
				added: new Set([3]),
				deletedBefore: new Set(),
				modified: new Set([1]),
			},
			editStatus,
		);

		expect(merged.modified.has(1)).toBe(true);
		expect(merged.modified.has(2)).toBe(true);
		expect(merged.added.has(3)).toBe(true);
	});
});

describe("FileViewer", () => {
	const editorComponent = ({ content }: EditableSourceEditorProps) => (
		<textarea readOnly value={content} />
	);

	test("reloads file preview data when only git metadata changes", () => {
		expect(
			resolveFilePreviewReloadTrigger({
				gitRevision: 0,
				treeRevision: 1,
			}),
		).not.toBe(
			resolveFilePreviewReloadTrigger({
				gitRevision: 1,
				treeRevision: 1,
			}),
		);
	});

	test("changes the scroll restore trigger when a file reload settles", () => {
		expect(resolveFilePreviewScrollRestoreTrigger({ loading: true })).not.toBe(
			resolveFilePreviewScrollRestoreTrigger({ loading: false }),
		);
	});

	test("uses the repo-relative git change path for line status diffs", () => {
		expect(
			resolveGitLineStatusDiffPath({
				file: {
					path: "daily-memories/2026-05-11.md",
					gitChange: {
						path: "agents/railly/daily-memories/2026-05-11.md",
						status: "modified",
					},
				},
				path: "daily-memories/2026-05-11.md",
			}),
		).toBe("agents/railly/daily-memories/2026-05-11.md");
	});

	test("waits for matching file metadata before fetching line status diffs", () => {
		expect(
			resolveGitLineStatusDiffPath({
				file: {
					path: "old.md",
					gitChange: {
						path: "agents/railly/old.md",
						status: "modified",
					},
				},
				path: "new.md",
			}),
		).toBeNull();
	});

	test("renders the available preview tabs in the subheader", () => {
		const html = renderToStaticMarkup(
			<FilePreviewHeader
				path="agents/john-doe/AGENTS.md"
				mode="rendered"
				availableModes={["rendered", "source", "git"]}
				onSelectMode={() => {}}
			/>,
		);

		expect(html).toContain(">agents/john-doe/AGENTS.md</div>");
		expect(html).toContain(">Preview</button>");
		expect(html).toContain(">Edit</button>");
		expect(html).toContain(">Git</button>");
		expect(html).toContain("border-b border-brand pb-0.5 text-dark-50");
	});

	test("omits unavailable preview tabs", () => {
		const html = renderToStaticMarkup(
			<FilePreviewHeader
				path="agents/john-doe/notes.txt"
				mode="source"
				availableModes={["source"]}
				onSelectMode={() => {}}
			/>,
		);

		expect(html).toContain(">agents/john-doe/notes.txt</div>");
		expect(html).not.toContain(">Preview</button>");
		expect(html).toContain(">Edit</button>");
		expect(html).not.toContain(">Git</button>");
	});

	test("selects a preview tab from the tab strip", () => {
		let selectedMode: FilePreviewMode | null = null;
		const header = FilePreviewHeader({
			path: "agents/john-doe/AGENTS.md",
			mode: "rendered",
			availableModes: ["rendered", "source"],
			onSelectMode: (nextMode) => {
				selectedMode = nextMode;
			},
		});
		const sourceButton = findButtonByLabel(header, "Edit");

		expect(sourceButton).not.toBeNull();
		sourceButton?.onClick?.();

		expect(selectedMode).toBe("source");
	});

	test("defaults markdown to rendered and non-markdown to source", () => {
		expect(defaultFilePreviewMode("AGENTS.md")).toBe("rendered");
		expect(defaultFilePreviewMode("notes.txt")).toBe("source");
	});

	test("renders markdown files in rendered mode by default", () => {
		const html = renderToStaticMarkup(
			<FilePreviewContent
				conflictNotice={false}
				editorComponent={editorComponent}
				error={null}
				file={textFile("AGENTS.md", "# Title\n\nBody")}
				inlineGitDiff={{ diff: null, error: null, loading: false }}
				isMarkdown={true}
				loading={false}
				mode="rendered"
				onAcceptReload={() => {}}
				onDiscard={() => {}}
				onSave={async () => {}}
				path="AGENTS.md"
				saveError={null}
				savedFile={null}
				saving={false}
				sourceResetKey="agent-a:AGENTS.md"
			/>,
		);

		expect(html).toContain("<h1>Title</h1>");
		expect(html).toContain("Body");
		expect(html).not.toContain("language-markdown");
	});

	test("renders non-markdown text files in source mode by default", () => {
		const html = renderToStaticMarkup(
			<FilePreviewContent
				conflictNotice={false}
				editorComponent={editorComponent}
				error={null}
				file={textFile("notes.txt", "plain text")}
				inlineGitDiff={{ diff: null, error: null, loading: false }}
				isMarkdown={false}
				loading={false}
				mode="source"
				onAcceptReload={() => {}}
				onDiscard={() => {}}
				onSave={async () => {}}
				path="notes.txt"
				saveError={null}
				savedFile={null}
				saving={false}
				sourceResetKey="agent-a:notes.txt"
			/>,
		);

		expect(html).toContain("plain text");
		expect(html).toContain(">Save<");
		expect(html).toContain(">Revert<");
	});

	test("renders inline git diff content in git mode", () => {
		const html = renderToStaticMarkup(
			<FilePreviewContent
				conflictNotice={false}
				editorComponent={editorComponent}
				error={null}
				file={textFile("AGENTS.md", "# Title\n", {
					gitChange: {
						path: "agents/john-doe/AGENTS.md",
						status: "modified",
					},
				})}
				inlineGitDiff={{
					diff: {
						path: "agents/john-doe/AGENTS.md",
						diff: "diff --git a/agents/john-doe/AGENTS.md b/agents/john-doe/AGENTS.md\n--- a/agents/john-doe/AGENTS.md\n+++ b/agents/john-doe/AGENTS.md\n@@ -1 +1 @@\n-# Old\n+# New\n",
					},
					error: null,
					loading: false,
				}}
				isMarkdown={true}
				loading={false}
				mode="git"
				onAcceptReload={() => {}}
				onDiscard={() => {}}
				onSave={async () => {}}
				path="AGENTS.md"
				saveError={null}
				savedFile={null}
				saving={false}
				sourceResetKey="agent-a:AGENTS.md"
			/>,
		);

		expect(html).toContain("<diffs-container");
		expect(html).toContain('data-diff-style="unified"');
	});

	test("does not render a manual refresh button in the preview header", () => {
		const html = renderToStaticMarkup(
			<FileViewer
				tabId="agent-a:AGENTS.md"
				path="AGENTS.md"
				agentId="agent-a"
			/>,
		);

		expect(html).toContain("AGENTS.md");
		expect(html).not.toContain("Refresh");
	});
});
