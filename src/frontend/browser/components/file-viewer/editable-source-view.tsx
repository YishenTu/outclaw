import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { EditorView as CodeMirrorEditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { diffLines } from "diff";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
	fileLineStatusGutter,
	updateStripeStatus,
} from "./codemirror-gutter-stripe.ts";
import { outclawCodeMirrorTheme } from "./codemirror-theme.ts";
import type { FileLineStatus } from "./parse-file-line-status.ts";

export interface EditableSourceViewProps {
	content: string;
	resetKey?: string;
	language?: string;
	gitLineStatus?: FileLineStatus;
	onSave(content: string): Promise<void>;
	onDiscard?(): void;
	saveError: string | null;
	saving: boolean;
	conflictNotice: boolean;
	onAcceptReload(): void;
	onDirtyChange?(dirty: boolean): void;
	editorComponent?: EditableSourceEditorComponent;
}

export type EditableSourceEditorComponent = (
	props: EditableSourceEditorProps,
) => ReactNode;

export interface EditableSourceEditorProps {
	content: string;
	language?: string;
	lineStatus: FileLineStatus;
	onChange(content: string): void;
}

export function EditableSourceView({
	content,
	resetKey,
	language,
	gitLineStatus,
	onSave,
	onDiscard,
	saveError,
	saving,
	conflictNotice,
	onAcceptReload,
	onDirtyChange,
	editorComponent: EditorComponent = CodeMirrorSourceEditor,
}: EditableSourceViewProps) {
	const [currentContent, setCurrentContent] = useState(content);
	const dirty = currentContent !== content;
	const mergedLineStatus = useMemo(
		() =>
			mergeFileLineStatus(
				gitLineStatus,
				diffFileLineStatus(content, currentContent),
			),
		[content, currentContent, gitLineStatus],
	);

	useEffect(() => {
		void resetKey;
		setCurrentContent(content);
	}, [content, resetKey]);

	useEffect(() => {
		onDirtyChange?.(dirty);
	}, [dirty, onDirtyChange]);

	const handleSave = () => {
		if (!dirty || saving) {
			return;
		}
		void onSave(currentContent);
	};

	const handleRevert = () => {
		if (!dirty) {
			return;
		}
		if (dirty && !window.confirm("Discard unsaved changes?")) {
			return;
		}
		setCurrentContent(content);
		onDiscard?.();
	};

	return (
		<div className="flex min-h-0 flex-col bg-dark-950">
			{conflictNotice ? (
				<div className="flex items-center justify-between gap-4 border-b border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
					<span>File changed on disk.</span>
					<button
						type="button"
						onClick={onAcceptReload}
						className="font-mono-ui text-[11px] uppercase tracking-[0.12em] text-warning transition-colors hover:text-dark-50"
					>
						Reload
					</button>
				</div>
			) : null}
			<EditableSourceToolbar
				dirty={dirty}
				onRevert={handleRevert}
				onSave={handleSave}
				saving={saving}
			/>
			{saveError ? (
				<div className="border-b border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
					{saveError}
				</div>
			) : null}
			<div className="min-h-[320px] flex-1">
				<EditorComponent
					content={currentContent}
					language={language}
					lineStatus={mergedLineStatus}
					onChange={setCurrentContent}
				/>
			</div>
		</div>
	);
}

export function EditableSourceToolbar({
	dirty,
	onRevert,
	onSave,
	saving,
}: {
	dirty: boolean;
	onRevert: () => void;
	onSave: () => void;
	saving: boolean;
}) {
	return (
		<div className="flex min-h-8 items-center gap-3 px-3 py-1.5">
			<div
				className="flex min-w-0 flex-1 items-center gap-2 font-mono-ui text-[11px] uppercase tracking-[0.12em] text-dark-500"
				data-dirty={dirty ? "true" : "false"}
			>
				<span
					className={`h-1.5 w-1.5 shrink-0 rounded-full ${
						dirty ? "bg-warning" : "bg-success/70"
					}`}
				/>
				<span className="truncate">
					{dirty ? "Unsaved changes" : "In sync"}
				</span>
			</div>
			<button
				type="button"
				onClick={onSave}
				disabled={!dirty || saving}
				className="inline-flex h-6 shrink-0 items-center rounded border border-dark-700 px-2 font-mono-ui text-[11px] uppercase tracking-[0.12em] text-dark-200 transition-colors hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:border-dark-800 disabled:text-dark-600"
			>
				{saving ? "Saving" : "Save"}
			</button>
			<button
				type="button"
				onClick={onRevert}
				disabled={!dirty}
				className="inline-flex h-6 shrink-0 items-center rounded border border-dark-800 px-2 font-mono-ui text-[11px] uppercase tracking-[0.12em] text-dark-400 transition-colors hover:border-dark-600 hover:text-dark-100 disabled:cursor-not-allowed disabled:border-dark-800 disabled:text-dark-600"
			>
				Revert
			</button>
		</div>
	);
}

function CodeMirrorSourceEditor({
	content,
	language,
	lineStatus,
	onChange,
}: EditableSourceEditorProps) {
	const viewRef = useRef<EditorView | null>(null);
	const stripeExtension = useMemo(() => fileLineStatusGutter(), []);
	const extensions = useMemo(
		() => [
			CodeMirrorEditorView.lineWrapping,
			stripeExtension,
			...languageExtensions(language),
		],
		[language, stripeExtension],
	);

	useEffect(() => {
		if (viewRef.current) {
			updateStripeStatus(viewRef.current, lineStatus);
		}
	}, [lineStatus]);

	return (
		<CodeMirror
			value={content}
			basicSetup={{
				foldGutter: false,
				highlightActiveLine: false,
				highlightActiveLineGutter: false,
			}}
			extensions={extensions}
			height="100%"
			onChange={onChange}
			onCreateEditor={(view) => {
				viewRef.current = view;
				updateStripeStatus(view, lineStatus);
			}}
			theme={outclawCodeMirrorTheme}
		/>
	);
}

function languageExtensions(language: string | undefined): Extension[] {
	switch (language) {
		case "markdown":
			return [markdown()];
		case "javascript":
		case "jsx":
			return [javascript({ jsx: true })];
		case "typescript":
		case "tsx":
			return [javascript({ jsx: language === "tsx", typescript: true })];
		case "json":
			return [json()];
		case "css":
		case "scss":
			return [css()];
		case "html":
			return [html()];
		case "yaml":
			return [yaml()];
		default:
			return [];
	}
}

export function diffFileLineStatus(
	baseline: string,
	current: string,
): FileLineStatus {
	const status = createEmptyLineStatus();
	let currentLine = 1;
	let removedLines = 0;

	for (const part of diffLines(baseline, current)) {
		const lineCount = countLines(part.value);
		if (part.removed) {
			removedLines += lineCount;
			continue;
		}

		if (part.added) {
			const target = removedLines > 0 ? status.modified : status.added;
			for (let offset = 0; offset < lineCount; offset += 1) {
				target.add(currentLine + offset);
			}
			currentLine += lineCount;
			removedLines = 0;
			continue;
		}

		if (removedLines > 0) {
			status.deletedBefore.add(currentLine);
			removedLines = 0;
		}
		currentLine += lineCount;
	}

	if (removedLines > 0) {
		status.deletedBefore.add(currentLine);
	}

	return status;
}

export function mergeFileLineStatus(
	base: FileLineStatus | undefined,
	overlay: FileLineStatus,
): FileLineStatus {
	const merged = {
		added: new Set(base?.added ?? []),
		deletedBefore: new Set(base?.deletedBefore ?? []),
		modified: new Set(base?.modified ?? []),
	};

	for (const line of overlay.added) {
		merged.modified.delete(line);
		merged.added.add(line);
	}
	for (const line of overlay.modified) {
		merged.added.delete(line);
		merged.modified.add(line);
	}
	for (const line of overlay.deletedBefore) {
		merged.deletedBefore.add(line);
	}

	return merged;
}

function createEmptyLineStatus(): FileLineStatus {
	return {
		added: new Set(),
		deletedBefore: new Set(),
		modified: new Set(),
	};
}

function countLines(value: string): number {
	if (value.length === 0) {
		return 0;
	}
	const normalized = value.replace(/\r\n/g, "\n");
	const lines = normalized.split("\n");
	return lines.at(-1) === "" ? lines.length - 1 : lines.length;
}

