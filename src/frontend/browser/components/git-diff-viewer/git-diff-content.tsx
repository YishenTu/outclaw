import type { BrowserGitDiffResponse } from "../../../../common/protocol.ts";
import { CodePreview } from "../file-viewer/file-viewer.tsx";
import {
	type GitDiffFileStatus,
	type ParsedGitDiffLine,
	parseGitDiff,
} from "./parse-git-diff.ts";

interface GitDiffContentProps {
	diff: BrowserGitDiffResponse;
}

function statusLabel(status: GitDiffFileStatus): string {
	switch (status) {
		case "added":
			return "Added";
		case "deleted":
			return "Deleted";
		case "renamed":
			return "Renamed";
		default:
			return "Modified";
	}
}

function lineClasses(line: ParsedGitDiffLine): string {
	switch (line.kind) {
		case "addition":
			return "bg-emerald-500/10 text-emerald-50";
		case "deletion":
			return "bg-red-500/10 text-red-50";
		case "meta":
			return "bg-amber-500/10 text-amber-100";
		default:
			return "bg-dark-950/40 text-dark-200";
	}
}

function markerClasses(line: ParsedGitDiffLine): string {
	switch (line.kind) {
		case "addition":
			return "text-emerald-300";
		case "deletion":
			return "text-red-300";
		case "meta":
			return "text-amber-300";
		default:
			return "text-dark-500";
	}
}

function renderLineNumber(value: number | null): string {
	return value === null ? "" : String(value);
}

function renderLineContent(content: string): string {
	return content.length > 0 ? content : " ";
}

export function GitDiffContent({ diff }: GitDiffContentProps) {
	if (diff.diff.trim() === "") {
		return (
			<div className="border border-dark-800 bg-dark-900/40 px-5 py-4 text-sm text-dark-300">
				No diff output.
			</div>
		);
	}

	const files = parseGitDiff(diff.diff, diff.path);
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
			{files.map((file) => (
				<section
					key={file.key}
					className="overflow-hidden rounded-xl bg-dark-900/50"
				>
					<div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
						<div className="min-w-0">
							<div className="text-[11px] uppercase tracking-[0.16em] text-dark-500">
								{statusLabel(file.status)}
							</div>
							<div className="truncate text-sm text-dark-100">
								{file.displayPath}
							</div>
							{file.status === "renamed" && (
								<div className="mt-1 text-[11px] text-dark-500">
									{file.oldPath} -&gt; {file.newPath}
								</div>
							)}
						</div>
						<div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] tabular-nums">
							<span className="text-emerald-300">+{file.additions}</span>
							<span className="text-red-300">-{file.deletions}</span>
						</div>
					</div>

					<div className="flex flex-col gap-4 px-4 py-4">
						{file.hunks.map((hunk) => (
							<div
								key={hunk.key}
								className="overflow-hidden rounded-lg bg-dark-950/40"
							>
								<div>
									{hunk.lines.map((line) => (
										<div
											key={line.key}
											className={`grid grid-cols-[2.75rem_2.75rem_1rem_minmax(0,1fr)] text-xs leading-6 ${lineClasses(line)}`}
										>
											<div className="px-1.5 py-1 font-mono text-right text-dark-500 tabular-nums">
												{renderLineNumber(line.oldLineNumber)}
											</div>
											<div className="px-1.5 py-1 font-mono text-right text-dark-500 tabular-nums">
												{renderLineNumber(line.newLineNumber)}
											</div>
											<div
												className={`px-0.5 py-1 text-center font-mono ${markerClasses(line)}`}
											>
												{line.marker}
											</div>
											<div className="font-mono min-w-0 px-3 py-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
												{renderLineContent(line.content)}
											</div>
										</div>
									))}
								</div>
							</div>
						))}
					</div>
				</section>
			))}
		</div>
	);
}
