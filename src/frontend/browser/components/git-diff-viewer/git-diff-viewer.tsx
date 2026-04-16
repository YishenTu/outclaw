import { AlertCircle, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { BrowserGitDiffResponse } from "../../../../common/protocol.ts";
import { fetchGitDiff } from "../../lib/api.ts";

interface GitDiffViewerProps {
	path: string;
}

export function GitDiffViewer({ path }: GitDiffViewerProps) {
	const [diff, setDiff] = useState<BrowserGitDiffResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [refreshKey, setRefreshKey] = useState(0);

	useEffect(() => {
		let cancelled = false;
		const requestVersion = refreshKey;
		setLoading(true);
		setError(null);

		void fetchGitDiff(path)
			.then((nextDiff) => {
				if (!cancelled && requestVersion === refreshKey) {
					setDiff(nextDiff);
				}
			})
			.catch((nextError) => {
				if (!cancelled && requestVersion === refreshKey) {
					setDiff(null);
					setError(
						nextError instanceof Error
							? nextError.message
							: "Failed to load diff",
					);
				}
			})
			.finally(() => {
				if (!cancelled && requestVersion === refreshKey) {
					setLoading(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [path, refreshKey]);

	return (
		<div className="flex h-full min-h-0 flex-col bg-dark-950">
			<div className="h-8 shrink-0 border-b border-dark-800 px-6">
				<div className="mx-auto flex h-full max-w-5xl items-center justify-between gap-4">
					<div className="min-w-0">
						<div className="font-mono-ui text-[11px] uppercase tracking-[0.16em] text-dark-500">
							Git diff / {path}
						</div>
					</div>
					<button
						type="button"
						onClick={() => setRefreshKey((current) => current + 1)}
						className="font-mono-ui inline-flex items-center gap-2 rounded px-2 py-1 text-[11px] uppercase tracking-[0.14em] text-dark-400 transition-colors hover:bg-dark-900 hover:text-dark-100"
					>
						<RefreshCw size={13} />
						Refresh
					</button>
				</div>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
				<div className="mx-auto max-w-5xl">
					{loading ? (
						<div className="font-mono-ui text-[11px] uppercase tracking-[0.16em] text-dark-500">
							Loading diff…
						</div>
					) : error ? (
						<div className="flex items-start gap-3 border border-red-500/20 bg-red-500/10 px-4 py-4 text-red-200">
							<AlertCircle size={16} className="mt-0.5 shrink-0" />
							<div className="text-sm">{error}</div>
						</div>
					) : (
						<pre className="whitespace-pre-wrap border border-dark-800 bg-dark-900/40 p-4 text-xs leading-6 text-dark-100 [overflow-wrap:anywhere]">
							<code>{diff?.diff || "No diff output."}</code>
						</pre>
					)}
				</div>
			</div>
		</div>
	);
}
