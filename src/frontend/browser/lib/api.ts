import type {
	BrowserAgentsResponse,
	BrowserConfigResponse,
	BrowserCronEntry,
	BrowserCronHistoryCursor,
	BrowserCronHistoryResponse,
	BrowserFileResponse,
	BrowserGitCommitResponse,
	BrowserGitDiffResponse,
	BrowserGitStatusResponse,
	BrowserImageUploadResponse,
	BrowserInboxArchiveResponse,
	BrowserInboxCreateNoteResponse,
	BrowserInboxResponse,
	BrowserInboxRestoreResponse,
	BrowserTerminalRunCommandResponse,
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

export async function fetchConfigFile(): Promise<BrowserConfigResponse> {
	return parseJsonResponse(await fetch("/api/config"));
}

export async function updateConfigFile(
	document: Record<string, unknown>,
): Promise<BrowserConfigResponse> {
	return parseJsonResponse(
		await fetch("/api/config", {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
			},
			body: JSON.stringify({
				document,
			}),
		}),
	);
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

export async function fetchAgentCronHistory(
	agentId: string,
	params: {
		jobName: string;
		limit: number;
		before?: BrowserCronHistoryCursor;
	},
): Promise<BrowserCronHistoryResponse> {
	const url = new URL(
		`/api/agents/${encodeURIComponent(agentId)}/cron/history`,
		window.location.origin,
	);
	url.searchParams.set("name", params.jobName);
	url.searchParams.set("limit", String(params.limit));
	if (params.before) {
		url.searchParams.set("beforeRanAt", String(params.before.ranAt));
		url.searchParams.set("beforeProviderId", params.before.providerId);
		url.searchParams.set("beforeSessionId", params.before.sessionId);
	}
	return parseJsonResponse(await fetch(url));
}

export async function fetchAgentInbox(
	agentId: string,
): Promise<BrowserInboxResponse> {
	return parseJsonResponse(
		await fetch(`/api/agents/${encodeURIComponent(agentId)}/inbox`),
	);
}

export async function archiveAgentInboxItem(
	agentId: string,
	path: string,
): Promise<BrowserInboxArchiveResponse> {
	return parseJsonResponse(
		await fetch(`/api/agents/${encodeURIComponent(agentId)}/inbox/archive`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
			},
			body: JSON.stringify({
				path,
			}),
		}),
	);
}

export async function createAgentInboxNote(
	agentId: string,
	input: { body: string; title: string },
): Promise<BrowserInboxCreateNoteResponse> {
	return parseJsonResponse(
		await fetch(`/api/agents/${encodeURIComponent(agentId)}/inbox/note`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
			},
			body: JSON.stringify(input),
		}),
	);
}

export async function restoreAgentInboxItem(
	agentId: string,
	archivedPath: string,
	originalPath: string,
): Promise<BrowserInboxRestoreResponse> {
	return parseJsonResponse(
		await fetch(`/api/agents/${encodeURIComponent(agentId)}/inbox/restore`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
			},
			body: JSON.stringify({
				archivedPath,
				originalPath,
			}),
		}),
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

export async function updateAgentTerminalRunCommand(
	agentId: string,
	command: string,
): Promise<BrowserTerminalRunCommandResponse> {
	return parseJsonResponse(
		await fetch(
			`/api/agents/${encodeURIComponent(agentId)}/terminal-run-command`,
			{
				method: "PATCH",
				headers: {
					"content-type": "application/json",
				},
				body: JSON.stringify({
					command,
				}),
			},
		),
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

export async function initGitRepo(): Promise<BrowserGitStatusResponse> {
	return parseJsonResponse(
		await fetch("/api/git/init", {
			method: "POST",
		}),
	);
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

export async function uploadPromptImages(
	files: File[],
): Promise<BrowserImageUploadResponse["images"]> {
	const formData = new FormData();
	for (const file of files) {
		formData.append("images", file);
	}

	const response = await parseJsonResponse<BrowserImageUploadResponse>(
		await fetch("/api/images", {
			method: "POST",
			body: formData,
		}),
	);
	return response.images;
}
