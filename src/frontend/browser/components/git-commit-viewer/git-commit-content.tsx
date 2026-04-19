import type { BrowserGitCommitResponse } from "../../../../common/protocol.ts";
import { GitDiffContent } from "../git-diff-viewer/git-diff-content.tsx";

const commitDateFormatter = new Intl.DateTimeFormat("en-US", {
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
	month: "short",
	year: "numeric",
});

function shortSha(sha: string): string {
	return sha.slice(0, 7);
}

function splitCommitMessage(message: string): {
	body: string | null;
	subject: string;
} {
	const [subject = "", ...bodyParts] = message.split(/\n\n+/);
	const body = bodyParts.join("\n\n").trim();
	return {
		body: body === "" ? null : body,
		subject,
	};
}

export function GitCommitContent({
	commit,
}: {
	commit: BrowserGitCommitResponse;
}) {
	const { body, subject } = splitCommitMessage(commit.message);

	return (
		<div className="flex flex-col gap-6">
			<section className="overflow-hidden rounded-xl bg-dark-900/50">
				<div className="px-5 py-4">
					<div className="font-mono-ui text-[11px] uppercase tracking-[0.16em] text-dark-500">
						Commit / {shortSha(commit.sha)}
					</div>
					<h1 className="mt-2 text-lg text-dark-50">{subject}</h1>
					<div className="mt-4 flex flex-col gap-2 text-sm text-dark-300">
						<div>
							<span className="text-dark-500">Author</span> {commit.author.name}{" "}
							&lt;{commit.author.email}&gt;
						</div>
						<div>
							<span className="text-dark-500">Date</span>{" "}
							{commitDateFormatter.format(new Date(commit.author.date))}
						</div>
						<div>
							<span className="text-dark-500">Parents</span>{" "}
							{commit.parents.length === 0
								? "None"
								: commit.parents
										.map((parent) => shortSha(parent.sha))
										.join(", ")}
						</div>
						{commit.parents.length > 1 ? (
							<div className="text-[11px] text-warning">
								Patch shown against the first parent.
							</div>
						) : null}
					</div>
					{body ? (
						<div className="mt-4 whitespace-pre-wrap text-sm text-dark-100">
							{body}
						</div>
					) : null}
				</div>
			</section>

			<GitDiffContent
				diff={{ path: shortSha(commit.sha), diff: commit.diff }}
			/>
		</div>
	);
}
