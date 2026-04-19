import { AlertCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { BrowserGitCommitResponse } from "../../../../common/protocol.ts";
import { fetchGitCommit } from "../../lib/api.ts";
import {
	selectGitRevision,
	useRightPanelRefreshStore,
} from "../../stores/right-panel-refresh.ts";
import { GitCommitContent } from "./git-commit-content.tsx";

function shortSha(sha: string): string {
	return sha.slice(0, 7);
}

export function GitCommitViewer({
	sha,
	title,
}: {
	sha: string;
	title: string;
}) {
	const [commit, setCommit] = useState<BrowserGitCommitResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const gitRevision = useRightPanelRefreshStore(selectGitRevision);

	useEffect(() => {
		void gitRevision;

		let cancelled = false;
		setLoading(true);
		setError(null);

		void fetchGitCommit(sha)
			.then((nextCommit) => {
				if (!cancelled) {
					setCommit(nextCommit);
				}
			})
			.catch((nextError) => {
				if (!cancelled) {
					setCommit(null);
					setError(
						nextError instanceof Error
							? nextError.message
							: "Failed to load commit",
					);
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
	}, [gitRevision, sha]);

	return (
		<div className="flex h-full min-h-0 flex-col bg-dark-950">
			<div className="h-8 shrink-0 border-b border-dark-800 px-6">
				<div className="mx-auto flex h-full max-w-5xl items-center gap-4">
					<div className="min-w-0 truncate font-mono-ui text-[11px] uppercase tracking-[0.16em] text-dark-500">
						Commit / {shortSha(sha)} {title}
					</div>
				</div>
			</div>

			<div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-6 py-6">
				<div className="mx-auto max-w-5xl">
					{loading ? (
						<div className="font-mono-ui text-[11px] uppercase tracking-[0.16em] text-dark-500">
							Loading commit…
						</div>
					) : error ? (
						<div className="flex items-start gap-3 border border-danger/30 bg-danger/10 px-4 py-4 text-danger">
							<AlertCircle size={16} className="mt-0.5 shrink-0" />
							<div className="text-sm">{error}</div>
						</div>
					) : (
						commit && <GitCommitContent commit={commit} />
					)}
				</div>
			</div>
		</div>
	);
}

export { GitCommitContent } from "./git-commit-content.tsx";
