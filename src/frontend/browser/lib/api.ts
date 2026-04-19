import type {
	BrowserAgentsResponse,
	BrowserCronEntry,
	BrowserFileResponse,
	BrowserGitCommitResponse,
	BrowserGitDiffResponse,
	BrowserGitStatusResponse,
	BrowserTreeEntry,
} from "../../../common/protocol.ts";

async function parseJsonResponse<T>(response: Response): Promise<T> {
	if (!response.ok) {
		const errorBody = (await response.json().catch(() => undefined)) as
			| { error?: string }
			| undefined;
		throw new Error(errorBody?.error ?? `Request failed: ${response.status}`);
	}

	return (await response.json()) as T;
}

export async function fetchSidebarSummary(): Promise<BrowserAgentsResponse> {
	return parseJsonResponse(await fetch("/api/agents"));
}

export async function fetchAgentTree(
	agentId: string,
): Promise<BrowserTreeEntry[]> {
	return parseJsonResponse(
		await fetch(`/api/agents/${encodeURIComponent(agentId)}/tree`),
	);
}

export async function fetchAgentCron(
	agentId: string,
): Promise<BrowserCronEntry[]> {
	return parseJsonResponse(
		await fetch(`/api/agents/${encodeURIComponent(agentId)}/cron`),
	);
}

export async function updateAgentCronEnabled(
	agentId: string,
	path: string,
	enabled: boolean,
): Promise<BrowserCronEntry> {
	return parseJsonResponse(
		await fetch(`/api/agents/${encodeURIComponent(agentId)}/cron`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
			},
			body: JSON.stringify({
				path,
				enabled,
			}),
		}),
	);
}

export async function fetchAgentFile(
	agentId: string,
	path: string,
): Promise<BrowserFileResponse> {
	const url = new URL(
		`/api/agents/${encodeURIComponent(agentId)}/files`,
		window.location.origin,
	);
	url.searchParams.set("path", path);
	return parseJsonResponse(await fetch(url));
}

export async function fetchGitStatus(): Promise<BrowserGitStatusResponse> {
	return parseJsonResponse(await fetch("/api/git/status"));
}

export async function fetchGitDiff(
	path: string,
): Promise<BrowserGitDiffResponse> {
	const url = new URL("/api/git/diff", window.location.origin);
	url.searchParams.set("path", path);
	return parseJsonResponse(await fetch(url));
}

export async function fetchGitCommit(
	sha: string,
): Promise<BrowserGitCommitResponse> {
	const url = new URL("/api/git/commit", window.location.origin);
	url.searchParams.set("sha", sha);
	return parseJsonResponse(await fetch(url));
}
