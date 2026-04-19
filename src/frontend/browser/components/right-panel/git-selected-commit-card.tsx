import {
	CalendarDays,
	Check,
	Copy,
	CornerDownLeft,
	GitCommitHorizontal,
	User,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BrowserGitGraphCommit } from "../../../../common/protocol.ts";

const selectedCommitDateFormatter = new Intl.DateTimeFormat("en-US", {
	day: "numeric",
	month: "short",
	year: "numeric",
});

const COPY_FEEDBACK_MS = 1200;

function shortSha(sha: string): string {
	return sha.slice(0, 7);
}

function commitSubject(message: string): string {
	const newline = message.indexOf("\n");
	return newline === -1 ? message : message.slice(0, newline);
}

function useCopyToClipboard(): {
	copied: boolean;
	copy: (value: string) => void;
} {
	const [copied, setCopied] = useState(false);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		return () => {
			if (timeoutRef.current !== null) {
				clearTimeout(timeoutRef.current);
			}
		};
	}, []);

	const copy = useCallback((value: string) => {
		if (!navigator.clipboard) {
			return;
		}
		navigator.clipboard
			.writeText(value)
			.then(() => {
				setCopied(true);
				if (timeoutRef.current !== null) {
					clearTimeout(timeoutRef.current);
				}
				timeoutRef.current = setTimeout(() => {
					setCopied(false);
					timeoutRef.current = null;
				}, COPY_FEEDBACK_MS);
			})
			.catch(() => {});
	}, []);

	return { copied, copy };
}

export function GitSelectedCommitCard({
	commit,
	onOpenCommit,
}: {
	commit: BrowserGitGraphCommit;
	onOpenCommit?: (commit: BrowserGitGraphCommit) => void;
}) {
	const subject = commitSubject(commit.commit.message);
	const parentShas = commit.parents.map((parent) => shortSha(parent.sha));
	const { copied, copy } = useCopyToClipboard();

	return (
		<section className="relative overflow-hidden rounded-lg border border-dark-800 bg-dark-950 shadow-[0_10px_28px_-16px_rgba(0,0,0,0.75)]">
			<header className="flex items-center justify-between gap-3 border-b border-dark-800 bg-dark-900 px-3 py-2">
				<span className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-dark-500">
					Selected commit
				</span>
				<button
					type="button"
					onClick={() => copy(commit.sha)}
					aria-label={copied ? "Copied commit SHA" : "Copy commit SHA"}
					title={copied ? "Copied" : "Copy full SHA"}
					className="font-mono-ui inline-flex items-center gap-1.5 rounded border border-dark-800 bg-dark-950 px-1.5 py-0.5 text-[11px] tabular-nums text-dark-100 transition-colors hover:border-brand/60 hover:text-dark-50"
				>
					{shortSha(commit.sha)}
					{copied ? (
						<Check size={11} className="text-success" />
					) : (
						<Copy size={11} className="text-dark-500" />
					)}
				</button>
			</header>

			<div className="px-3 py-3">
				<div className="text-sm leading-snug text-dark-50">{subject}</div>

				<div className="mt-3 flex items-end gap-3">
					<dl className="flex min-w-0 flex-1 flex-col gap-1.5 text-xs text-dark-300">
						<div className="flex items-center gap-2">
							<User size={12} className="shrink-0 text-dark-500" />
							<dt className="sr-only">Author</dt>
							<dd className="truncate">{commit.commit.author.name}</dd>
						</div>
						<div className="flex items-center gap-2">
							<CalendarDays size={12} className="shrink-0 text-dark-500" />
							<dt className="sr-only">Date</dt>
							<dd className="tabular-nums">
								{selectedCommitDateFormatter.format(
									new Date(commit.commit.author.date),
								)}
							</dd>
						</div>
						<div className="flex items-center gap-2">
							<GitCommitHorizontal
								size={12}
								className="shrink-0 text-dark-500"
							/>
							<dt className="shrink-0 text-dark-500">Parents</dt>
							<dd className="min-w-0 flex-1 truncate">
								{parentShas.length === 0 ? (
									<span className="text-dark-400">None</span>
								) : (
									<span className="font-mono-ui tabular-nums text-dark-200">
										{parentShas.join(" · ")}
									</span>
								)}
							</dd>
						</div>
					</dl>
					{onOpenCommit ? (
						<button
							type="button"
							onClick={() => onOpenCommit(commit)}
							className="font-mono-ui inline-flex shrink-0 items-center gap-1.5 rounded border border-dark-700 bg-dark-900 px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] text-dark-200 transition-colors hover:border-brand/60 hover:bg-dark-800 hover:text-dark-50"
						>
							Open commit
							<CornerDownLeft size={12} />
						</button>
					) : null}
				</div>
			</div>
		</section>
	);
}
