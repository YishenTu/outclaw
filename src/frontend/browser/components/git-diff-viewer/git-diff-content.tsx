import {
	type FileDiffMetadata,
	parsePatchFiles,
	type SupportedLanguages,
	setLanguageOverride,
} from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import type { CSSProperties } from "react";
import type { BrowserGitDiffResponse } from "../../../../common/protocol.ts";
import { CodePreview } from "../file-viewer/file-viewer.tsx";

export type GitDiffStyle = "unified" | "split";

interface GitDiffContentProps {
	diff: BrowserGitDiffResponse;
	diffStyle?: GitDiffStyle;
}

export function languageForDiffPath(path: string): SupportedLanguages {
	const lowerPath = path.toLowerCase();
	if (lowerPath.endsWith(".ts") || lowerPath.endsWith(".tsx")) {
		return "typescript";
	}
	if (lowerPath.endsWith(".js") || lowerPath.endsWith(".jsx")) {
		return "javascript";
	}
	if (lowerPath.endsWith(".md")) {
		return "markdown";
	}
	if (lowerPath.endsWith(".json")) {
		return "json";
	}
	if (lowerPath.endsWith(".css")) {
		return "css";
	}
	if (lowerPath.endsWith(".html")) {
		return "html";
	}
	if (lowerPath.endsWith(".yaml") || lowerPath.endsWith(".yml")) {
		return "yaml";
	}
	if (lowerPath.endsWith(".sh")) {
		return "shell";
	}
	return "text";
}

function languageSourcePath(
	file: FileDiffMetadata,
	fallbackPath: string,
): string {
	if (file.name && file.name !== "/dev/null") {
		return file.name;
	}
	if (file.prevName && file.prevName !== "/dev/null") {
		return file.prevName;
	}
	return fallbackPath;
}

export function pierreDiffFiles(
	diff: BrowserGitDiffResponse,
): FileDiffMetadata[] {
	return parsePatchFiles(diff.diff, diff.path)
		.flatMap((patch) => patch.files)
		.filter((file) => file.hunks.length > 0)
		.map((file) =>
			setLanguageOverride(
				file,
				languageForDiffPath(languageSourcePath(file, diff.path)),
			),
		);
}

export function GitDiffContent({
	diff,
	diffStyle = "unified",
}: GitDiffContentProps) {
	if (diff.diff.trim() === "") {
		return (
			<div className="border border-dark-800 bg-dark-900/40 px-5 py-4 text-sm text-dark-300">
				No diff output.
			</div>
		);
	}

	const files = pierreDiffFiles(diff);
	if (files.length === 0) {
		return (
			<div className="overflow-hidden rounded-xl border border-dark-800 bg-dark-900/50">
				<div className="border-b border-dark-800 px-4 py-3">
					<div className="font-mono-ui text-[11px] uppercase tracking-[0.16em] text-dark-500">
						Raw diff
					</div>
				</div>
				<div className="px-4 py-4">
					<CodePreview content={diff.diff} language="diff" />
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-6">
			{files.map((file, index) => (
				<div
					key={file.cacheKey ?? `${file.name}:${index}`}
					data-diff-style={diffStyle}
				>
					<FileDiff
						fileDiff={file}
						options={{ diffStyle, overflow: "wrap" }}
						className="block"
						style={
							{
								// Make Pierre's whole panel inherit the site bg (dark-950).
								// Pierre resolves `--diffs-bg` via
								// `light-dark(--diffs-light-bg, --diffs-dark-bg)`, so overriding
								// `--diffs-dark-bg` recolors the panel, header, gutter, and any
								// other non-addition/deletion surface in dark mode without
								// disturbing the colored +/- line tints.
								"--diffs-dark-bg": "var(--dark-950)",
								"--diffs-light-bg": "var(--dark-950)",
							} as CSSProperties
						}
					/>
				</div>
			))}
		</div>
	);
}
