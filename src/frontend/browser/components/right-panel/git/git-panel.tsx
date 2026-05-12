import { ChevronDown, ChevronUp } from "lucide-react";
import type { ReactNode, UIEvent } from "react";
import type {
	BrowserGitHistoryCommit,
	BrowserGitInitializedResponse,
	BrowserGitStatusResponse,
} from "../../../../../common/protocol.ts";
import { GitCommitHistory } from "./git-commit-history.tsx";
import { gitPanelFileToneClass } from "./git-status-tone.ts";
import { GitUninitializedCard } from "./git-uninitialized-card.tsx";

const GIT_PANEL_SECTION_HEADER_CLASS =
	"mb-2 flex shrink-0 items-center justify-between gap-3 px-2";
const GIT_PANEL_META_CLASS =
	"font-mono-ui flex shrink-0 items-center gap-2 text-xs tabular-nums";
const GIT_PANEL_TOGGLE_CLASS =
	"flex items-center justify-end text-dark-500 transition-colors hover:text-dark-100";
const GIT_HISTORY_LOAD_MORE_THRESHOLD_PX = 120;

interface GitPanelProps {
	historyCollapsed?: boolean;
	onCommit?: () => void;
	onInitialize?: () => Promise<void>;
	onLoadMoreHistory?: () => void;
	onOpenCommit?: (commit: BrowserGitHistoryCommit) => void;
	repositoryId?: string;
	status: BrowserGitStatusResponse | null;
	historyLoadError?: string | null;
	historyLoadingMore?: boolean;
	loading: boolean;
	error: string | null;
	onOpenDiff: (path: string) => void;
	onSelectCommit?: (sha: string | null) => void;
	onToggleHistoryCollapsed?: () => void;
	selectedCommitSha?: string | null;
}

function GitFileLineCounts({
	additions,
	deletions,
}: {
	additions: number;
	deletions: number;
}) {
	if (additions === 0 && deletions === 0) {
		return null;
	}

	return (
		<span className={GIT_PANEL_META_CLASS}>
			{additions > 0 ? (
				<span className="text-success">+{additions}</span>
			) : null}
			{deletions > 0 ? <span className="text-danger">-{deletions}</span> : null}
		</span>
	);
}

function GitPanelSection({
	action,
	collapsed = false,
	onScroll,
	title,
	children,
}: {
	action?: ReactNode;
	collapsed?: boolean;
	onScroll?: (event: UIEvent<HTMLDivElement>) => void;
	title: string;
	children: ReactNode;
}) {
	return (
		<section
			className={
				collapsed ? "flex shrink-0 flex-col" : "flex min-h-0 flex-1 flex-col"
			}
		>
			<div
				className={`${GIT_PANEL_SECTION_HEADER_CLASS} ${
					collapsed ? "mb-0" : ""
				}`}
			>
				<div className="font-mono-ui text-[11px] uppercase tracking-[0.16em] text-dark-500">
					{title}
				</div>
				{action}
			</div>
			{collapsed ? null : (
				<div
					className="scrollbar-none min-h-0 flex-1 overflow-y-auto"
					onScroll={onScroll}
				>
					{children}
				</div>
			)}
		</section>
	);
}

function formatGitBranch(status: BrowserGitInitializedResponse): string {
	return status.branch ? `Branch ${status.branch}` : "Detached HEAD";
}

export function shouldLoadMoreGitHistory({
	clientHeight,
	hasMore,
	loading,
	scrollHeight,
	scrollTop,
}: {
	clientHeight: number;
	hasMore: boolean;
	loading: boolean;
	scrollHeight: number;
	scrollTop: number;
}): boolean {
	if (!hasMore || loading) {
		return false;
	}

	return (
		scrollHeight - (scrollTop + clientHeight) <=
		GIT_HISTORY_LOAD_MORE_THRESHOLD_PX
	);
}

function formatGitSummary(
	status: BrowserGitInitializedResponse,
): string | null {
	if (status.clean) {
		return null;
	}

	return `${status.files.length} changed file${status.files.length === 1 ? "" : "s"}`;
}

export function GitPanelHeader({
	status,
	onCommit,
}: {
	status: BrowserGitInitializedResponse;
	onCommit?: () => void;
}) {
	const summary = formatGitSummary(status);

	return (
		<div className="h-8 shrink-0 border-b border-dark-800 px-3">
			<div className="flex h-full items-center justify-between gap-3 px-1">
				<div className="font-mono-ui text-[11px] uppercase tracking-[0.16em] text-dark-500">
					{formatGitBranch(status)}
				</div>
				<div className="flex min-w-0 items-center justify-end gap-3">
					{summary ? (
						<div className="truncate text-xs text-dark-400">{summary}</div>
					) : null}
					{!status.clean && onCommit ? (
						<button
							type="button"
							onClick={onCommit}
							aria-label="Send commit and push prompt to active agent"
							className="font-mono-ui inline-flex h-6 shrink-0 items-center rounded border border-dark-800 px-2 text-[11px] uppercase tracking-[0.12em] text-dark-300 transition-colors hover:border-dark-600 hover:text-dark-50"
						>
							Commit and push
						</button>
					) : null}
				</div>
			</div>
		</div>
	);
}

export function GitPanel({
	historyCollapsed = false,
	historyLoadError = null,
	historyLoadingMore = false,
	onCommit,
	onInitialize,
	onLoadMoreHistory,
	onOpenCommit,
	repositoryId,
	status,
	loading,
	error,
	onOpenDiff,
	onSelectCommit,
	onToggleHistoryCollapsed,
	selectedCommitSha = null,
}: GitPanelProps) {
	if (loading) {
		return (
			<div className="px-4 py-4 text-sm text-dark-500">Loading git status…</div>
		);
	}

	if (error) {
		return <div className="px-4 py-4 text-sm text-danger">{error}</div>;
	}

	if (!status) {
		return <div className="px-4 py-4 text-sm text-dark-500">No git data.</div>;
	}

	if (!status.initialized) {
		return (
			<GitUninitializedCard
				root={status.root}
				onInitialize={onInitialize ?? (async () => {})}
			/>
		);
	}

	function handleHistoryScroll(event: UIEvent<HTMLDivElement>) {
		if (
			historyCollapsed ||
			!onLoadMoreHistory ||
			!status?.initialized ||
			!shouldLoadMoreGitHistory({
				clientHeight: event.currentTarget.clientHeight,
				hasMore: Boolean(status.history.nextCursor),
				loading: historyLoadingMore,
				scrollHeight: event.currentTarget.scrollHeight,
				scrollTop: event.currentTarget.scrollTop,
			})
		) {
			return;
		}

		onLoadMoreHistory();
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<GitPanelHeader status={status} onCommit={onCommit} />
			<div className="flex min-h-0 flex-1 flex-col gap-4 px-3 py-3">
				<GitPanelSection title="Changed files">
					<div className="space-y-0.5">
						{status.files.length === 0 ? (
							<div className="px-2 py-1 text-sm text-dark-500">No changes.</div>
						) : (
							status.files.map((file) => (
								<button
									key={`${file.path}:${file.indexStatus}:${file.worktreeStatus}`}
									type="button"
									onClick={() => onOpenDiff(file.path)}
									className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm transition-colors hover:bg-dark-900 ${gitPanelFileToneClass(file)}`}
								>
									<span className="truncate">{file.path}</span>
									<span className="ml-2 shrink-0">
										<GitFileLineCounts
											additions={file.additions}
											deletions={file.deletions}
										/>
									</span>
								</button>
							))
						)}
					</div>
				</GitPanelSection>

				<GitPanelSection
					title="Commit history"
					collapsed={historyCollapsed}
					onScroll={handleHistoryScroll}
					action={
						<div className="flex w-8 shrink-0 justify-end">
							<button
								type="button"
								onClick={onToggleHistoryCollapsed}
								aria-label={
									historyCollapsed
										? "Expand commit history"
										: "Collapse commit history"
								}
								className={GIT_PANEL_TOGGLE_CLASS}
							>
								{historyCollapsed ? (
									<ChevronUp size={14} />
								) : (
									<ChevronDown size={14} />
								)}
							</button>
						</div>
					}
				>
					<GitCommitHistory
						history={status.history}
						loadError={historyLoadError}
						loadingMore={historyLoadingMore}
						onOpenCommit={onOpenCommit}
						onSelectCommit={onSelectCommit}
						repositoryId={repositoryId}
						selectedCommitSha={selectedCommitSha}
					/>
				</GitPanelSection>
			</div>
		</div>
	);
}
