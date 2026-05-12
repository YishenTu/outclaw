import {
	AlertCircle,
	ArrowRight,
	Check,
	Copy,
	CopyX,
	CornerDownLeft,
} from "lucide-react";
import { useEffect, useState } from "react";
import type {
	BrowserGitCommitFileChangeType,
	BrowserGitCommitStats,
	BrowserGitHistoryCommit,
} from "../../../../../common/protocol.ts";
import { useCopyToClipboard } from "../../../clipboard/use-copy-to-clipboard.ts";
import { fetchGitCommitStats } from "../../../lib/api.ts";
import {
	selectGitRevision,
	useRightPanelRefreshStore,
} from "../../../stores/right-panel-refresh.ts";
import { gitCommitSubject, shortGitSha } from "./git-commit-format.ts";

const commitHistoryDateFormatter = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
});

const CHANGE_BADGE: Record<
	BrowserGitCommitFileChangeType,
	{ label: string; className: string }
> = {
	added: { label: "A", className: "bg-success/15 text-success" },
	modified: { label: "M", className: "bg-brand/15 text-brand" },
	deleted: { label: "D", className: "bg-danger/15 text-danger" },
	renamed: { label: "R", className: "bg-warning/15 text-warning" },
	copied: { label: "C", className: "bg-warning/15 text-warning" },
	"type-changed": { label: "T", className: "bg-dark-700 text-dark-200" },
};

function splitCommitMessage(message: string): {
	body: string | null;
	subject: string;
} {
	const newline = message.indexOf("\n");
	if (newline === -1) {
		return { body: null, subject: message };
	}
	const subject = message.slice(0, newline);
	const body = message.slice(newline + 1).trim();
	return { body: body === "" ? null : body, subject };
}

interface GitCommitHistoryItemProps {
	commit: BrowserGitHistoryCommit;
	onOpenCommit?: (commit: BrowserGitHistoryCommit) => void;
	onToggleSelect: () => void;
	repositoryId?: string;
	selected: boolean;
}

export function GitCommitHistoryItem({
	commit,
	onOpenCommit,
	onToggleSelect,
	repositoryId,
	selected,
}: GitCommitHistoryItemProps) {
	return (
		<article
			className={
				selected
					? "commit-history-selected-card overflow-hidden rounded-lg border border-dark-800 bg-dark-950 shadow-[0_10px_28px_-16px_rgba(0,0,0,0.75)]"
					: "rounded"
			}
		>
			<CommitItemHeader
				commit={commit}
				onToggle={onToggleSelect}
				selected={selected}
			/>
			{selected ? (
				<CommitItemDetails
					commit={commit}
					onOpenCommit={onOpenCommit}
					repositoryId={repositoryId}
				/>
			) : null}
		</article>
	);
}

function CommitItemHeader({
	commit,
	onToggle,
	selected,
}: {
	commit: BrowserGitHistoryCommit;
	onToggle: () => void;
	selected: boolean;
}) {
	const subject = gitCommitSubject(commit.commit.message);
	const formattedDate = commitHistoryDateFormatter.format(
		new Date(commit.commit.author.date),
	);
	return (
		// biome-ignore lint/a11y/useSemanticElements: header hosts a nested copy <button>, so it cannot itself be a <button>.
		<div
			role="button"
			tabIndex={0}
			aria-pressed={selected}
			onClick={onToggle}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onToggle();
				}
			}}
			className={`flex w-full min-w-0 cursor-pointer flex-col gap-0.5 px-2 py-1.5 text-left transition-colors ${
				selected
					? "text-dark-50"
					: "rounded text-dark-300 hover:bg-dark-900 hover:text-dark-100"
			}`}
		>
			<span
				className={
					selected
						? "block text-sm leading-5 text-dark-50"
						: "block truncate text-sm leading-5"
				}
			>
				{subject}
			</span>
			<span className="flex min-w-0 items-center gap-2 text-xs text-dark-500">
				<CommitShaCopy sha={commit.sha} />
				<span className="min-w-0 truncate">{commit.commit.author.name}</span>
				<span className="shrink-0 tabular-nums">· {formattedDate}</span>
			</span>
		</div>
	);
}

function CommitItemDetails({
	commit,
	onOpenCommit,
	repositoryId,
}: {
	commit: BrowserGitHistoryCommit;
	onOpenCommit?: (commit: BrowserGitHistoryCommit) => void;
	repositoryId?: string;
}) {
	const { body } = splitCommitMessage(commit.commit.message);
	const [stats, setStats] = useState<BrowserGitCommitStats | null>(null);
	const [statsError, setStatsError] = useState<string | null>(null);
	const [statsLoading, setStatsLoading] = useState(true);
	const gitRevision = useRightPanelRefreshStore(selectGitRevision);

	useEffect(() => {
		void gitRevision;
		let cancelled = false;
		setStats(null);
		setStatsError(null);
		setStatsLoading(true);

		void fetchGitCommitStats(
			commit.sha,
			repositoryId ? { repositoryId } : undefined,
		)
			.then((next) => {
				if (!cancelled) {
					setStats(next);
				}
			})
			.catch((error) => {
				if (!cancelled) {
					setStatsError(
						error instanceof Error ? error.message : "Failed to load stats",
					);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setStatsLoading(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [commit.sha, gitRevision, repositoryId]);

	return (
		<div className="px-3 pb-3">
			{body ? (
				<div className="whitespace-pre-wrap text-xs leading-relaxed text-dark-300">
					{body}
				</div>
			) : null}

			<div
				className={`flex items-center justify-between gap-3 border-t border-dark-800 pt-3 ${body ? "mt-3" : ""}`}
			>
				<CommitStatsSummary
					error={statsError}
					loading={statsLoading}
					stats={stats}
				/>
				{onOpenCommit ? (
					<button
						type="button"
						onClick={(event) => {
							event.stopPropagation();
							onOpenCommit(commit);
						}}
						className="font-mono-ui inline-flex shrink-0 items-center gap-1.5 rounded border border-dark-700 bg-dark-900 px-2 py-0.5 text-[11px] uppercase tracking-[0.14em] text-dark-200 transition-colors hover:border-brand/60 hover:bg-dark-800 hover:text-dark-50"
					>
						Open
						<CornerDownLeft size={12} />
					</button>
				) : null}
			</div>

			{stats && stats.files.length > 0 ? (
				<CommitFileList files={stats.files} />
			) : null}
		</div>
	);
}

function CommitStatsSummary({
	error,
	loading,
	stats,
}: {
	error: string | null;
	loading: boolean;
	stats: BrowserGitCommitStats | null;
}) {
	if (loading) {
		return (
			<div className="font-mono-ui text-[11px] uppercase tracking-[0.16em] text-dark-500">
				Loading changes…
			</div>
		);
	}
	if (error) {
		return (
			<div className="flex items-start gap-2 text-xs text-danger">
				<AlertCircle size={12} className="mt-0.5 shrink-0" />
				<span>{error}</span>
			</div>
		);
	}
	if (!stats) {
		return null;
	}
	const fileCount = stats.files.length;
	if (fileCount === 0) {
		return (
			<div className="font-mono-ui text-[11px] uppercase tracking-[0.16em] text-dark-500">
				No file changes
			</div>
		);
	}
	return (
		<div className="flex items-center gap-3 text-xs text-dark-300">
			<span className="tabular-nums">
				{fileCount} {fileCount === 1 ? "file" : "files"}
			</span>
			<span className="font-mono-ui tabular-nums text-success">
				+{stats.totalAdditions}
			</span>
			<span className="font-mono-ui tabular-nums text-danger">
				-{stats.totalDeletions}
			</span>
		</div>
	);
}

function CommitFileList({ files }: { files: BrowserGitCommitStats["files"] }) {
	return (
		<ol className="scrollbar-none mt-2 max-h-72 space-y-0.5 overflow-y-auto">
			{files.map((file) => {
				const badge = CHANGE_BADGE[file.change];
				const key =
					file.renamedFrom !== undefined
						? `${file.renamedFrom}->${file.path}`
						: file.path;
				return (
					<li
						key={key}
						className="flex items-center gap-2 rounded px-1.5 py-1 text-xs text-dark-200 hover:bg-dark-900"
					>
						<span
							className={`font-mono-ui inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-semibold tabular-nums ${badge.className}`}
							title={file.change}
						>
							{badge.label}
						</span>
						<span className="min-w-0 flex-1 truncate font-mono-ui text-[12px]">
							{file.renamedFrom !== undefined ? (
								<span className="text-dark-300">
									<span className="text-dark-500">{file.renamedFrom}</span>
									<ArrowRight
										size={10}
										className="mx-1 inline-block align-middle text-dark-600"
									/>
									{file.path}
								</span>
							) : (
								file.path
							)}
						</span>
						<span className="shrink-0 font-mono-ui text-[11px] tabular-nums">
							{file.binary ? (
								<span className="text-dark-500">binary</span>
							) : (
								<>
									<span className="text-success">+{file.additions}</span>
									<span className="ml-1.5 text-danger">-{file.deletions}</span>
								</>
							)}
						</span>
					</li>
				);
			})}
		</ol>
	);
}

function CommitShaCopy({ sha }: { sha: string }) {
	const { copied, failed, copy } = useCopyToClipboard();
	return (
		<button
			type="button"
			onClick={(event) => {
				event.stopPropagation();
				copy(sha);
			}}
			aria-label={
				copied
					? "Copied commit SHA"
					: failed
						? "Copy commit SHA failed"
						: "Copy commit SHA"
			}
			title={copied ? "Copied" : failed ? "Copy failed" : "Copy full SHA"}
			className="font-mono-ui inline-flex shrink-0 items-center gap-1 tabular-nums transition-colors hover:text-dark-200"
		>
			{shortGitSha(sha)}
			{copied ? (
				<Check size={10} className="text-success" />
			) : failed ? (
				<CopyX size={10} className="text-danger" />
			) : (
				<Copy size={10} className="text-dark-600" />
			)}
		</button>
	);
}
