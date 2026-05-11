import hljs from "highlight.js";
import { AlertCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { BrowserFileResponse } from "../../../../common/protocol.ts";
import {
	FileConflictError,
	fetchAgentFile,
	fetchGitDiff,
	writeAgentFile,
} from "../../lib/api.ts";
import { fileNameFromPath } from "../../lib/path-display.ts";
import {
	selectAgentTreeRevision,
	selectGitRevision,
	useRightPanelRefreshStore,
} from "../../stores/right-panel-refresh.ts";
import { useTabsStore } from "../../stores/tabs.ts";
import { GitDiffContent } from "../git-diff-viewer/git-diff-content.tsx";
import { useGitDiff } from "../git-diff-viewer/use-git-diff.ts";
import {
	BROWSER_MARKDOWN_REHYPE_PLUGINS,
	BROWSER_MARKDOWN_REMARK_PLUGINS,
} from "../markdown/markdown-pipeline.ts";
import { remarkWikilinks } from "../markdown/remark-wikilinks.ts";
import {
	type EditableSourceEditorComponent,
	EditableSourceView,
} from "./editable-source-view.tsx";
import { splitMarkdownFrontmatter } from "./markdown-frontmatter.ts";
import {
	type FileLineStatus,
	parseFileLineStatus,
} from "./parse-file-line-status.ts";
import { remarkHtmlComments } from "./remark-html-comments.ts";

interface FileViewerProps {
	active?: boolean;
	tabId: string;
	path: string;
	agentId: string;
}

const FILE_PREVIEW_CODE_BLOCK_CLASSES =
	"[&_pre]:overflow-x-hidden [&_pre]:whitespace-pre-wrap [&_pre]:[overflow-wrap:anywhere] [&_pre_code]:whitespace-pre-wrap";

function isMarkdownFile(path: string): boolean {
	return path.toLowerCase().endsWith(".md");
}

function buildCodeFence(content: string, language?: string): string {
	const longestBacktickRun = Math.max(
		0,
		...Array.from(content.matchAll(/`+/g), (match) => match[0].length),
	);
	const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));
	return `${fence}${language ?? ""}\n${content}\n${fence}`;
}

export function resolveFilePreviewScrollRestoreTrigger({
	loading,
}: {
	loading: boolean;
}): string {
	return loading ? "loading" : "settled";
}

export function resolveFilePreviewReloadTrigger({
	gitRevision,
	treeRevision,
}: {
	gitRevision: number;
	treeRevision: number;
}): string {
	return `${treeRevision}:${gitRevision}`;
}

export function resolveGitLineStatusDiffPath({
	file,
	path,
}: {
	file: Pick<BrowserFileResponse, "gitChange" | "path"> | null;
	path: string;
}): string | null {
	if (!file || file.path !== path) {
		return null;
	}

	return file.gitChange?.path ?? null;
}

function browserFileChanged(
	baseline: BrowserFileResponse,
	nextFile: BrowserFileResponse,
): boolean {
	return (
		baseline.kind !== nextFile.kind ||
		baseline.mtimeMs !== nextFile.mtimeMs ||
		baseline.sha256 !== nextFile.sha256
	);
}

export function MarkdownPreview({ content }: { content: string }) {
	const preview = useMemo(() => splitMarkdownFrontmatter(content), [content]);
	const markdownBody = preview?.body ?? content;
	const hasMarkdownBody = markdownBody.trim().length > 0;

	return (
		<div className="space-y-6">
			{preview && (
				<div>
					<CodePreview content={preview.frontmatter} language="yaml" />
					{hasMarkdownBody ? <hr className="border-dark-800" /> : null}
				</div>
			)}

			{hasMarkdownBody ? (
				<div
					className={`prose prose-invert prose-sm max-w-none text-dark-100 [&_code::before]:content-none [&_code::after]:content-none ${FILE_PREVIEW_CODE_BLOCK_CLASSES}`}
				>
					<ReactMarkdown
						remarkPlugins={[
							...BROWSER_MARKDOWN_REMARK_PLUGINS,
							remarkHtmlComments,
							remarkWikilinks,
						]}
						rehypePlugins={BROWSER_MARKDOWN_REHYPE_PLUGINS}
					>
						{markdownBody}
					</ReactMarkdown>
				</div>
			) : null}
		</div>
	);
}

export function CodePreview({
	content,
	language,
}: {
	content: string;
	language?: string;
}) {
	const markdown = useMemo(() => {
		const supportedLanguage =
			language && hljs.getLanguage(language) ? language : undefined;
		return buildCodeFence(content, supportedLanguage);
	}, [content, language]);

	const preview = (
		<div
			className={`prose prose-invert max-w-none text-dark-100 [&_pre]:m-0 [&_pre]:border-0 [&_pre]:bg-transparent [&_pre]:p-0 [&_pre]:text-[12px] [&_pre]:leading-5 [&_pre_code]:bg-transparent ${FILE_PREVIEW_CODE_BLOCK_CLASSES}`}
		>
			<ReactMarkdown
				remarkPlugins={BROWSER_MARKDOWN_REMARK_PLUGINS}
				rehypePlugins={BROWSER_MARKDOWN_REHYPE_PLUGINS}
			>
				{markdown}
			</ReactMarkdown>
		</div>
	);

	return preview;
}

export type FilePreviewMode = "rendered" | "source" | "git";

const FILE_PREVIEW_MODE_LABELS: Record<FilePreviewMode, string> = {
	rendered: "Preview",
	source: "Edit",
	git: "Git",
};

interface FilePreviewHeaderProps {
	path: string;
	mode: FilePreviewMode;
	availableModes: readonly FilePreviewMode[];
	onSelectMode: (next: FilePreviewMode) => void;
}

export function FilePreviewHeader({
	availableModes,
	mode,
	onSelectMode,
	path,
}: FilePreviewHeaderProps) {
	return (
		<div className="h-8 shrink-0 border-b border-dark-800 px-6">
			<div className="mx-auto flex h-full max-w-5xl items-center gap-4">
				<div className="min-w-0 flex-1 truncate font-mono-ui text-[11px] uppercase tracking-[0.16em] text-dark-500">
					{path}
				</div>
				<div className="flex items-center gap-3">
					{availableModes.map((nextMode) => {
						const active = nextMode === mode;
						return (
							<button
								key={nextMode}
								type="button"
								onClick={() => onSelectMode(nextMode)}
								aria-current={active ? "page" : undefined}
								className={`font-mono-ui text-[11px] uppercase tracking-[0.16em] transition-colors ${
									active
										? "border-b border-brand pb-0.5 text-dark-50"
										: "text-dark-500 hover:text-dark-100"
								}`}
							>
								{FILE_PREVIEW_MODE_LABELS[nextMode]}
							</button>
						);
					})}
				</div>
			</div>
		</div>
	);
}

export function defaultFilePreviewMode(path: string): FilePreviewMode {
	return isMarkdownFile(path) ? "rendered" : "source";
}

interface FilePreviewContentProps {
	conflictNotice: boolean;
	editorComponent?: EditableSourceEditorComponent;
	error: string | null;
	file: BrowserFileResponse | null;
	gitLineStatus?: FileLineStatus;
	inlineGitDiff: ReturnType<typeof useGitDiff>;
	isMarkdown: boolean;
	loading: boolean;
	mode: FilePreviewMode;
	onAcceptReload: () => void;
	onDirtyChange?: (dirty: boolean) => void;
	onDiscard?: () => void;
	onSave: (content: string) => Promise<void>;
	path: string;
	saveError: string | null;
	savedFile: BrowserFileResponse | null;
	saving: boolean;
	sourceResetKey: string;
}

export function FilePreviewContent({
	conflictNotice,
	editorComponent,
	error,
	file,
	gitLineStatus,
	inlineGitDiff,
	isMarkdown,
	loading,
	mode,
	onAcceptReload,
	onDirtyChange,
	onDiscard,
	onSave,
	path,
	saveError,
	savedFile,
	saving,
	sourceResetKey,
}: FilePreviewContentProps) {
	const fileName = fileNameFromPath(path);

	if (loading) {
		return (
			<div className="font-mono-ui text-[11px] uppercase tracking-[0.16em] text-dark-500">
				Loading file…
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex items-start gap-3 border border-danger/30 bg-danger/10 px-4 py-4 text-danger">
				<AlertCircle size={16} className="mt-0.5 shrink-0" />
				<div className="text-sm">{error}</div>
			</div>
		);
	}

	if (file?.kind === "binary" && mode !== "git") {
		return (
			<div className="border border-dark-800 bg-dark-900/40 px-5 py-4 text-sm text-dark-300">
				Binary file preview is not supported for `{fileName}`.
			</div>
		);
	}

	const sourceView =
		file?.kind === "text" ? (
			<div key="source" className={mode === "source" ? undefined : "hidden"}>
				<EditableSourceView
					content={savedFile?.content ?? file.content ?? ""}
					conflictNotice={conflictNotice}
					editorComponent={editorComponent}
					gitLineStatus={gitLineStatus}
					language={isMarkdown ? "markdown" : file.language}
					onAcceptReload={onAcceptReload}
					onDirtyChange={onDirtyChange}
					onDiscard={onDiscard}
					onSave={onSave}
					resetKey={sourceResetKey}
					saveError={saveError}
					saving={saving}
				/>
			</div>
		) : null;

	return (
		<>
			{isMarkdown ? (
				<div
					key="rendered"
					className={mode === "rendered" ? undefined : "hidden"}
				>
					<MarkdownPreview content={file?.content ?? ""} />
				</div>
			) : null}
			{sourceView}
			<div key="git" className={mode === "git" ? undefined : "hidden"}>
				{renderGitPreview(inlineGitDiff)}
			</div>
		</>
	);
}

function renderGitPreview(inlineGitDiff: ReturnType<typeof useGitDiff>) {
	if (inlineGitDiff.loading) {
		return (
			<div className="font-mono-ui text-[11px] uppercase tracking-[0.16em] text-dark-500">
				Loading diff…
			</div>
		);
	}
	if (inlineGitDiff.error) {
		return (
			<div className="flex items-start gap-3 border border-danger/30 bg-danger/10 px-4 py-4 text-danger">
				<AlertCircle size={16} className="mt-0.5 shrink-0" />
				<div className="text-sm">{inlineGitDiff.error}</div>
			</div>
		);
	}
	return inlineGitDiff.diff ? (
		<GitDiffContent diff={inlineGitDiff.diff} diffStyle="unified" />
	) : null;
}

export function FileViewer({
	active = true,
	tabId,
	path,
	agentId,
}: FileViewerProps) {
	const [file, setFile] = useState<BrowserFileResponse | null>(null);
	const [savedFile, setSavedFile] = useState<BrowserFileResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [gitLineStatus, setGitLineStatus] = useState<FileLineStatus | null>(
		null,
	);
	const [mode, setMode] = useState<FilePreviewMode>(() =>
		defaultFilePreviewMode(path),
	);
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [conflictNotice, setConflictNotice] = useState(false);
	const [loading, setLoading] = useState(true);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const editDirtyRef = useRef(false);
	// Mirror `savedFile` in a ref so the read effect can compare against the
	// baseline without taking a state dependency — depending on `savedFile`
	// caused a feedback loop (effect → setSavedFile(newObject) → effect → …)
	// that manifested as a flickering loading state on file open.
	const savedFileRef = useRef<BrowserFileResponse | null>(null);
	savedFileRef.current = savedFile;
	const treeRevision = useRightPanelRefreshStore((state) =>
		selectAgentTreeRevision(state, agentId),
	);
	const gitRevision = useRightPanelRefreshStore(selectGitRevision);
	const scrollTop = useTabsStore((state) => state.scrollPositions[tabId] ?? 0);
	const setScrollPosition = useTabsStore((state) => state.setScrollPosition);
	const scrollRestoreTrigger = resolveFilePreviewScrollRestoreTrigger({
		loading,
	});
	const reloadTrigger = resolveFilePreviewReloadTrigger({
		gitRevision,
		treeRevision,
	});
	const isMarkdown = isMarkdownFile(path);
	const defaultMode = defaultFilePreviewMode(path);
	const hasSourceMode = file?.kind !== "binary";
	const sourceFileLoaded = file?.kind === "text";
	const availableModes = useMemo<FilePreviewMode[]>(() => {
		const modes: FilePreviewMode[] = [];
		if (isMarkdown) {
			modes.push("rendered");
		}
		if (hasSourceMode) {
			modes.push("source");
		}
		if (file?.gitChange) {
			modes.push("git");
		}
		return modes;
	}, [file?.gitChange, hasSourceMode, isMarkdown]);
	const gitLineStatusDiffPath = resolveGitLineStatusDiffPath({ file, path });
	const inlineGitDiffPath =
		mode === "git" ? (file?.gitChange?.path ?? null) : null;
	const inlineGitDiff = useGitDiff(inlineGitDiffPath);
	const fileIdentity = `${agentId}:${path}`;
	const sourceResetKey = savedFile
		? `${agentId}:${savedFile.path}:${savedFile.mtimeMs ?? ""}:${
				savedFile.sha256 ?? ""
			}`
		: fileIdentity;

	useEffect(() => {
		void fileIdentity;

		setMode(defaultFilePreviewMode(path));
		editDirtyRef.current = false;
		setSavedFile(null);
		setSaveError(null);
		setConflictNotice(false);
	}, [fileIdentity, path]);

	useEffect(() => {
		if (availableModes.includes(mode)) {
			return;
		}

		const fallback = availableModes.includes(defaultMode)
			? defaultMode
			: (availableModes[0] ?? defaultMode);
		if (fallback !== mode) {
			setMode(fallback);
		}
	}, [availableModes, defaultMode, mode]);

	useEffect(() => {
		void reloadTrigger;

		let cancelled = false;
		const baseline = savedFileRef.current;
		if (editDirtyRef.current && baseline?.kind === "text") {
			void fetchAgentFile(agentId, path)
				.then((nextFile) => {
					if (cancelled) {
						return;
					}
					if (browserFileChanged(baseline, nextFile)) {
						setFile(nextFile);
						setConflictNotice(true);
					}
				})
				.catch((nextError) => {
					if (!cancelled) {
						console.warn("Failed to refresh edited file preview", nextError);
					}
				});

			return () => {
				cancelled = true;
			};
		}

		setLoading(true);
		setError(null);

		void fetchAgentFile(agentId, path)
			.then((nextFile) => {
				if (!cancelled) {
					setFile(nextFile);
					setSavedFile(nextFile.kind === "text" ? nextFile : null);
					setConflictNotice(false);
				}
			})
			.catch((nextError) => {
				if (!cancelled) {
					setError(
						nextError instanceof Error
							? nextError.message
							: "Failed to load file",
					);
					setFile(null);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setLoading(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [agentId, path, reloadTrigger]);

	useEffect(() => {
		void gitRevision;

		let cancelled = false;

		if (!sourceFileLoaded || !gitLineStatusDiffPath) {
			setGitLineStatus(null);
			return () => {
				cancelled = true;
			};
		}

		void fetchGitDiff(gitLineStatusDiffPath)
			.then((response) => {
				if (!cancelled) {
					// Match against the diff response's normalized path, not the
					// caller-supplied `path` — git emits its own canonical
					// repo-relative form in `+++ b/<path>` lines.
					setGitLineStatus(parseFileLineStatus(response.diff, response.path));
				}
			})
			.catch((nextError) => {
				if (!cancelled) {
					setGitLineStatus(null);
					console.warn("Failed to load git line status", nextError);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [gitLineStatusDiffPath, gitRevision, sourceFileLoaded]);

	const handleSelectMode = useCallback(
		(nextMode: FilePreviewMode) => {
			if (nextMode === mode || !availableModes.includes(nextMode)) {
				return;
			}

			setMode(nextMode);
		},
		[availableModes, mode],
	);

	const handleSave = useCallback(
		async (content: string) => {
			if (
				savedFile?.kind !== "text" ||
				typeof savedFile.mtimeMs !== "number" ||
				!savedFile.sha256
			) {
				setSaveError("File is not loadable for write");
				return;
			}

			setSaving(true);
			setSaveError(null);
			try {
				const nextFile = await writeAgentFile(
					agentId,
					savedFile.path,
					content,
					{
						mtimeMs: savedFile.mtimeMs,
						sha256: savedFile.sha256,
					},
				);
				setFile(nextFile);
				setSavedFile(nextFile);
				editDirtyRef.current = false;
				setConflictNotice(false);
				useRightPanelRefreshStore.getState().bumpGitRevision();
			} catch (nextError) {
				if (nextError instanceof FileConflictError) {
					setFile(nextError.current);
					setConflictNotice(true);
					return;
				}
				setSaveError(
					nextError instanceof Error
						? nextError.message
						: "Failed to save file",
				);
			} finally {
				setSaving(false);
			}
		},
		[agentId, savedFile],
	);

	const handleDiscard = useCallback(() => {
		editDirtyRef.current = false;
		setSaveError(null);
		setConflictNotice(false);
	}, []);

	const handleAcceptReload = useCallback(async () => {
		setSaveError(null);
		try {
			const nextFile = await fetchAgentFile(agentId, path);
			setFile(nextFile);
			setSavedFile(nextFile.kind === "text" ? nextFile : null);
			editDirtyRef.current = false;
			setConflictNotice(false);
		} catch (nextError) {
			setSaveError(
				nextError instanceof Error
					? nextError.message
					: "Failed to reload file",
			);
		}
	}, [agentId, path]);

	const handleDirtyChange = useCallback((dirty: boolean) => {
		editDirtyRef.current = dirty;
	}, []);

	useEffect(() => {
		void scrollRestoreTrigger;

		if (!active) {
			return;
		}

		const container = containerRef.current;
		if (!container) {
			return;
		}

		container.scrollTop = scrollTop;
	}, [active, scrollRestoreTrigger, scrollTop]);

	return (
		<div className="flex h-full min-h-0 flex-col bg-dark-950">
			<FilePreviewHeader
				availableModes={availableModes}
				mode={mode}
				onSelectMode={handleSelectMode}
				path={path}
			/>

			<div
				ref={containerRef}
				onScroll={(event) =>
					setScrollPosition(tabId, event.currentTarget.scrollTop)
				}
				className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-6 py-6"
			>
				<div className="mx-auto max-w-5xl">
					<FilePreviewContent
						conflictNotice={conflictNotice}
						error={error}
						file={file}
						gitLineStatus={gitLineStatus ?? undefined}
						inlineGitDiff={inlineGitDiff}
						isMarkdown={isMarkdown}
						loading={loading}
						mode={mode}
						onAcceptReload={handleAcceptReload}
						onDirtyChange={handleDirtyChange}
						onDiscard={handleDiscard}
						onSave={handleSave}
						path={path}
						saveError={saveError}
						savedFile={savedFile}
						saving={saving}
						sourceResetKey={sourceResetKey}
					/>
				</div>
			</div>
		</div>
	);
}
