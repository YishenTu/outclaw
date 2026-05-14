import type {
	BrowserGitHistory,
	BrowserGitHistoryCommit,
} from "../../../../../common/protocol.ts";
import { GitCommitHistoryItem } from "./git-commit-history-item.tsx";
import type { GitCommitStatsScope } from "./git-commit-stats-cache.ts";

interface GitCommitHistoryProps {
	gitScope?: GitCommitStatsScope;
	history: BrowserGitHistory;
	loadingMore?: boolean;
	loadError?: string | null;
	onOpenCommit?: (commit: BrowserGitHistoryCommit) => void;
	onSelectCommit?: (sha: string | null) => void;
	selectedCommitSha?: string | null;
}

export function GitCommitHistory({
	gitScope,
	history,
	loadingMore = false,
	loadError = null,
	onOpenCommit,
	onSelectCommit,
	selectedCommitSha = null,
}: GitCommitHistoryProps) {
	if (history.commits.length === 0) {
		return (
			<div className="px-2 py-1 text-sm text-dark-500">
				No commit history yet.
			</div>
		);
	}

	return (
		<ol className="commit-history-list space-y-1">
			{history.commits.map((commit) => {
				const selected = selectedCommitSha === commit.sha;
				return (
					<li key={commit.sha}>
						<GitCommitHistoryItem
							commit={commit}
							gitScope={gitScope}
							onOpenCommit={onOpenCommit}
							onToggleSelect={() =>
								onSelectCommit?.(selected ? null : commit.sha)
							}
							selected={selected}
						/>
					</li>
				);
			})}
			{loadingMore ? (
				<li className="px-2 py-2 text-xs text-dark-500" aria-live="polite">
					Loading older commits…
				</li>
			) : null}
			{loadError ? (
				<li className="px-2 py-2 text-xs text-danger">{loadError}</li>
			) : null}
		</ol>
	);
}
