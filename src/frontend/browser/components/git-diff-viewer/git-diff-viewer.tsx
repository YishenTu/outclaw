import { AlertCircle, Columns, Rows } from "lucide-react";
import { useState } from "react";
import { GitDiffContent, type GitDiffStyle } from "./git-diff-content.tsx";
import { useGitDiff } from "./use-git-diff.ts";

interface GitDiffViewerProps {
	path: string;
	repositoryId?: string;
}

export function GitDiffViewer({ path, repositoryId }: GitDiffViewerProps) {
	const [diffStyle, setDiffStyle] = useState<GitDiffStyle>("unified");
	const { diff, loading, error } = useGitDiff(
		path,
		repositoryId ? { repositoryId } : undefined,
	);
	const nextDiffStyle = diffStyle === "unified" ? "split" : "unified";
	const toggleDiffStyleLabel =
		nextDiffStyle === "split"
			? "Switch to split diff"
			: "Switch to unified diff";

	return (
		<div className="flex h-full min-h-0 flex-col bg-dark-950">
			<div className="h-8 shrink-0 border-b border-dark-800 px-6">
				<div className="mx-auto flex h-full max-w-5xl items-center gap-4">
					<div className="min-w-0 flex-1 truncate font-mono-ui text-[11px] uppercase tracking-[0.16em] text-dark-500">
						Git diff / {path}
					</div>
					<button
						type="button"
						onClick={() => setDiffStyle(nextDiffStyle)}
						aria-label={toggleDiffStyleLabel}
						title={toggleDiffStyleLabel}
						className="flex items-center justify-center text-dark-500 transition-colors hover:text-dark-100"
					>
						{diffStyle === "unified" ? (
							<Columns size={13} />
						) : (
							<Rows size={13} />
						)}
					</button>
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
						diff && <GitDiffContent diff={diff} diffStyle={diffStyle} />
					)}
				</div>
			</div>
		</div>
	);
}
