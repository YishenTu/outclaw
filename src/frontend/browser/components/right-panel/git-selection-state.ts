import type { BrowserGitStatusResponse } from "../../../../common/protocol.ts";

export function shouldClearSelectedGitCommit(params: {
	selectedCommitSha: string | null;
	status: BrowserGitStatusResponse | null;
}): boolean {
	if (params.selectedCommitSha === null) {
		return false;
	}
	if (!params.status?.initialized) {
		return true;
	}
	return !params.status.graph.commits.some(
		(commit) => commit.sha === params.selectedCommitSha,
	);
}
