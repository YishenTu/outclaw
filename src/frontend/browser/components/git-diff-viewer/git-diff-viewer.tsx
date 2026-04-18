import { AlertCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { BrowserGitDiffResponse } from "../../../../common/protocol.ts";
import { fetchGitDiff } from "../../lib/api.ts";
import {
	selectGitRevision,
	useRightPanelRefreshStore,
} from "../../stores/right-panel-refresh.ts";
import { GitDiffContent } from "./git-diff-content.tsx";

interface GitDiffViewerProps {
	path: string;
}

export function GitDiffViewer({ path }: GitDiffViewerProps) {
	const [diff, setDiff] = useState<BrowserGitDiffResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const gitRevision = useRightPanelRefreshStore(selectGitRevision);

	useEffect(() => {
		void gitRevision;

		let cancelled = false;
		setLoading(true);
		setError(null);

		void fetchGitDiff(path)
			.then((nextDiff) => {
				if (!cancelled) {
					setDiff(nextDiff);
				}
			})
			.catch((nextError) => {
				if (!cancelled) {
					setDiff(null);
					setError(
						nextError instanceof Error
							? nextError.message
							: "Failed to load diff",
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
	}, [gitRevision, path]);

	return (
		<div className="flex h-full min-h-0 flex-col bg-dark-950">
			<div className="h-8 shrink-0 border-b border-dark-800 px-6">
				<div className="mx-auto flex h-full max-w-5xl items-center gap-4">
					<div className="min-w-0 font-mono-ui text-[11px] uppercase tracking-[0.16em] text-dark-500">
						Git diff / {path}
					</div>
				</div>
			</div>

			<div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-6 py-6">
				<div className="mx-auto max-w-5xl">
					{loading ? (
						<div className="font-mono-ui text-[11px] uppercase tracking-[0.16em] text-dark-500">
							Loading diff…
						</div>
					) : error ? (
						<div className="flex items-start gap-3 border border-danger/30 bg-danger/10 px-4 py-4 text-danger">
							<AlertCircle size={16} className="mt-0.5 shrink-0" />
							<div className="text-sm">{error}</div>
						</div>
					) : (
						diff && <GitDiffContent diff={diff} />
					)}
				</div>
			</div>
		</div>
	);
}
