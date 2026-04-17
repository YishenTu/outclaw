import type { BrowserGitGraphCommit } from "../../../../common/protocol.ts";

const tooltipDateFormatter = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	year: "numeric",
});

export function formatGitGraphTooltip(commit: BrowserGitGraphCommit): string {
	return `${commit.sha.slice(0, 7)}  ${commit.commit.author.name}  ${tooltipDateFormatter.format(new Date(commit.commit.author.date))}`;
}
