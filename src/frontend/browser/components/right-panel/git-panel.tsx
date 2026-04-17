import type { BrowserGitStatusResponse } from "../../../../common/protocol.ts";

interface GitPanelProps {
	status: BrowserGitStatusResponse | null;
	loading: boolean;
	error: string | null;
	onOpenDiff: (path: string) => void;
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
	status,
	loading,
	error,
	onOpenDiff,
}: GitPanelProps) {
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
			<div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-3 py-3">
				<div className="space-y-5">
					<section>
						<div className="font-mono-ui mb-2 text-[11px] uppercase tracking-[0.16em] text-dark-500">
							Changed files
						</div>
						<div className="space-y-0.5">
							{status.files.length === 0 ? (
								<div className="px-2 py-1 text-sm text-dark-500">
									No changes.
								</div>
							) : (
								status.files.map((file) => (
									<button
										key={`${file.path}:${file.indexStatus}:${file.worktreeStatus}`}
										type="button"
										onClick={() => onOpenDiff(file.path)}
										className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm text-dark-400 transition-colors hover:bg-dark-900 hover:text-dark-200"
									>
										<span className="truncate">{file.path}</span>
										<span className="font-mono-ui ml-2 shrink-0 text-[10px] text-dark-500">
											{`${file.indexStatus}${file.worktreeStatus}`.trim() ||
												"??"}
										</span>
									</button>
								))
							)}
						</div>
					</section>

					<section>
						<div className="font-mono-ui mb-2 text-[11px] uppercase tracking-[0.16em] text-dark-500">
							Git graph
						</div>
						{status.graph === "" ? (
							<div className="px-2 py-1 text-sm text-dark-500">
								No commit history yet.
							</div>
						) : (
							<pre className="whitespace-pre-wrap px-2 py-1 text-xs leading-6 text-dark-200 [overflow-wrap:anywhere]">
								{status.graph}
							</pre>
						)}
					</section>
				</div>
			</div>
		</div>
	);
}
