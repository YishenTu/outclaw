import { GitBranchPlus } from "lucide-react";
import { useState } from "react";

interface GitUninitializedCardProps {
	root: string;
	onInitialize: () => Promise<void>;
}

export function GitUninitializedCard({
	root,
	onInitialize,
}: GitUninitializedCardProps) {
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleClick = async () => {
		if (pending) {
			return;
		}
		setPending(true);
		setError(null);
		try {
			await onInitialize();
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Failed to initialize repo",
			);
		} finally {
			setPending(false);
		}
	};

	return (
		<div className="flex h-full min-h-0 items-center justify-center px-4 py-6">
			<div className="w-full max-w-sm px-1">
				<div className="flex items-center gap-2">
					<span className="flex h-7 w-7 items-center justify-center rounded-full border border-dark-700 bg-dark-950 text-dark-200">
						<GitBranchPlus size={14} />
					</span>
					<div className="font-mono-ui text-[11px] uppercase tracking-[0.16em] text-dark-400">
						Not a git repository
					</div>
				</div>
				<div className="mt-3 truncate font-mono-ui text-xs text-dark-500">
					{root}
				</div>
				<p className="mt-3 text-sm leading-6 text-dark-300">
					This directory isn&apos;t a git repo yet. Initialize it to track
					changes, browse history, and commit from this panel.
				</p>
				<div className="mt-4 flex justify-center">
					<button
						type="button"
						onClick={handleClick}
						disabled={pending}
						aria-label="Initialize git repository in the working directory"
						className="inline-flex h-8 items-center gap-2 rounded-md border border-dark-700 bg-dark-800 px-3 text-xs font-medium text-dark-50 transition-colors hover:border-dark-500 hover:bg-dark-700 disabled:cursor-not-allowed disabled:opacity-60"
					>
						{pending ? "Initializing…" : "Initialize repository"}
					</button>
				</div>
				{error ? <div className="mt-3 text-xs text-danger">{error}</div> : null}
			</div>
		</div>
	);
}
