import { type ReactNode, useState } from "react";
import type { BrowserGitStatusResponse } from "../../../../common/protocol.ts";
import { GitGraph } from "./git-graph.tsx";
import { gitFileToneClass } from "./git-status-tone.ts";

const GIT_PANEL_SECTION_HEADER_CLASS =
	"mb-2 flex shrink-0 items-center justify-between gap-3 px-2";
const GIT_PANEL_META_CLASS =
	"font-mono-ui flex shrink-0 items-center gap-2 text-xs tabular-nums";
const GIT_PANEL_TOGGLE_CLASS =
	"font-mono-ui flex w-full items-center justify-end text-[18px] leading-none text-dark-500 transition-colors hover:text-dark-100";

interface GitPanelProps {
	defaultGraphCollapsed?: boolean;
	status: BrowserGitStatusResponse | null;
	loading: boolean;
	error: string | null;
	onOpenDiff: (path: string) => void;
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
				<span className="text-emerald-300">+{additions}</span>
			) : null}
			{deletions > 0 ? (
				<span className="text-red-300">-{deletions}</span>
			) : null}
		</span>
	);
}

function GitPanelSection({
	action,
	collapsed = false,
	title,
	children,
}: {
	action?: ReactNode;
	collapsed?: boolean;
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
				<div className="scrollbar-none min-h-0 flex-1 overflow-y-auto">
					{children}
				</div>
			)}
		</section>
	);
}

function formatGitBranch(status: BrowserGitStatusResponse): string {
	return status.branch ? `Branch ${status.branch}` : "Detached HEAD";
}

function formatGitSummary(status: BrowserGitStatusResponse): string {
	return status.clean
		? "Working tree clean"
		: `${status.files.length} changed file${status.files.length === 1 ? "" : "s"}`;
}

export function GitPanelHeader({
	status,
}: {
	status: BrowserGitStatusResponse;
}) {
	return (
		<div className="h-8 shrink-0 border-b border-dark-800 px-3">
			<div className="flex h-full items-center justify-between gap-3 px-1">
				<div className="font-mono-ui text-[11px] uppercase tracking-[0.16em] text-dark-500">
					{formatGitBranch(status)}
				</div>
				<div className="truncate text-xs text-dark-400">
					{formatGitSummary(status)}
				</div>
			</div>
		</div>
	);
}

export function GitPanel({
	defaultGraphCollapsed = false,
	status,
	loading,
	error,
	onOpenDiff,
}: GitPanelProps) {
	const [graphCollapsed, setGraphCollapsed] = useState(defaultGraphCollapsed);

	if (loading) {
		return (
			<div className="px-4 py-4 text-sm text-dark-500">Loading git status…</div>
		);
	}

	if (error) {
		return <div className="px-4 py-4 text-sm text-red-300">{error}</div>;
	}

	if (!status) {
		return <div className="px-4 py-4 text-sm text-dark-500">No git data.</div>;
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<GitPanelHeader status={status} />
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
									className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm transition-colors hover:bg-dark-900 ${gitFileToneClass(file)}`}
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
					title="Git graph"
					collapsed={graphCollapsed}
					action={
						<div className="flex w-8 shrink-0 justify-end">
							<button
								type="button"
								onClick={() => setGraphCollapsed((current) => !current)}
								aria-label={
									graphCollapsed ? "Expand git graph" : "Collapse git graph"
								}
								className={GIT_PANEL_TOGGLE_CLASS}
							>
								{graphCollapsed ? "+" : "-"}
							</button>
						</div>
					}
				>
					<GitGraph currentBranch={status.branch} graph={status.graph} />
				</GitPanelSection>
			</div>
		</div>
	);
}
