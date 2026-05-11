import type {
	BrowserAgentsResponse,
	BrowserCodingRepositoryArchiveResponse,
	BrowserCodingRepositoryDetail,
	BrowserCodingRepositoryListResponse,
	BrowserCodingSessionDeleteResponse,
	BrowserCodingSessionDetail,
	BrowserCodingSessionPageResponse,
	BrowserConfigResponse,
	BrowserCronEntry,
	BrowserCronHistoryCursor,
	BrowserCronHistoryResponse,
	BrowserFileResponse,
	BrowserGitCommitResponse,
	BrowserGitDiffResponse,
	BrowserGitStatusResponse,
	BrowserGraphResponse,
	BrowserImageUploadResponse,
	BrowserInboxArchiveResponse,
	BrowserInboxCreateNoteResponse,
	BrowserInboxResponse,
	BrowserInboxRestoreResponse,
	BrowserLatencyResponse,
	BrowserSessionPageResponse,
	BrowserTerminalRunCommandResponse,
	BrowserTreeEntry,
	SessionCursor,
	WorkspaceFileEntry,
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

export class FileConflictError extends Error {
	readonly current: BrowserFileResponse;

	constructor(current: BrowserFileResponse) {
		super("File changed on disk");
		this.current = current;
		this.name = "FileConflictError";
	}
}

export async function fetchSidebarSummary(): Promise<BrowserAgentsResponse> {
	return parseJsonResponse(await fetch("/api/agents"));
}

export async function fetchAgentSessions(
	agentId: string,
	params: {
		limit: number;
		cursor?: SessionCursor;
		query?: string;
	},
): Promise<BrowserSessionPageResponse> {
	const url = new URL(
		`/api/agents/${encodeURIComponent(agentId)}/sessions`,
		window.location.origin,
	);
	url.searchParams.set("limit", String(params.limit));
	if (params.cursor) {
		url.searchParams.set("cursorLastActive", String(params.cursor.lastActive));
		url.searchParams.set("cursorSdkSessionId", params.cursor.sdkSessionId);
	}
	if (params.query?.trim()) {
		url.searchParams.set("query", params.query.trim());
	}
	return parseJsonResponse(await fetch(url));
}

export async function fetchAgentCodingSessions(
	agentId: string,
	params: {
		limit: number;
		cursor?: SessionCursor;
		linkedChat?: {
			agentId: string;
			providerId: string;
			sessionId: string;
		};
		providerId?: string;
		repositoryId?: string;
	},
): Promise<BrowserCodingSessionPageResponse> {
	const url = new URL(
		`/api/agents/${encodeURIComponent(agentId)}/coding-sessions`,
		window.location.origin,
	);
	url.searchParams.set("limit", String(params.limit));
	if (params.cursor) {
		url.searchParams.set("cursorLastActive", String(params.cursor.lastActive));
		url.searchParams.set("cursorSdkSessionId", params.cursor.sdkSessionId);
	}
	if (params.providerId) {
		url.searchParams.set("providerId", params.providerId);
	}
	if (params.repositoryId) {
		url.searchParams.set("repositoryId", params.repositoryId);
	}
	if (params.linkedChat) {
		url.searchParams.set("linkedChatAgentId", params.linkedChat.agentId);
		url.searchParams.set("linkedChatProviderId", params.linkedChat.providerId);
		url.searchParams.set("linkedChatSessionId", params.linkedChat.sessionId);
	}
	return parseJsonResponse(await fetch(url));
}

export async function fetchAgentCodingSession(
	agentId: string,
	providerId: string,
	sdkSessionId: string,
): Promise<BrowserCodingSessionDetail> {
	return parseJsonResponse(
		await fetch(
			`/api/agents/${encodeURIComponent(agentId)}/coding-sessions/${encodeURIComponent(providerId)}/${encodeURIComponent(sdkSessionId)}`,
		),
	);
}

export async function deleteAgentCodingSession(
	agentId: string,
	providerId: string,
	sdkSessionId: string,
): Promise<BrowserCodingSessionDeleteResponse> {
	return parseJsonResponse(
		await fetch(
			`/api/agents/${encodeURIComponent(agentId)}/coding-sessions/${encodeURIComponent(providerId)}/${encodeURIComponent(sdkSessionId)}`,
			{
				method: "DELETE",
			},
		),
	);
}

export async function fetchCodingRepositories(params?: {
	includeArchived?: boolean;
}): Promise<BrowserCodingRepositoryListResponse> {
	const url = new URL("/api/coding/repositories", window.location.origin);
	if (params?.includeArchived) {
		url.searchParams.set("includeArchived", "true");
	}
	return parseJsonResponse(await fetch(url));
}

export async function fetchCodingRepository(
	repositoryId: string,
): Promise<BrowserCodingRepositoryDetail> {
	return parseJsonResponse(
		await fetch(`/api/coding/repositories/${encodeURIComponent(repositoryId)}`),
	);
}

export async function registerAgentCodingRepository(
	agentId: string,
	params: {
		displayName?: string;
		remoteUrl?: string;
		rootCwd: string;
		source?: "manual" | "clone";
	},
): Promise<BrowserCodingRepositoryDetail> {
	return parseJsonResponse(
		await fetch(
			`/api/agents/${encodeURIComponent(agentId)}/coding-repositories`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
				},
				body: JSON.stringify(params),
			},
		),
	);
}

export async function archiveCodingRepository(
	repositoryId: string,
): Promise<BrowserCodingRepositoryArchiveResponse> {
	return parseJsonResponse(
		await fetch(
			`/api/coding/repositories/${encodeURIComponent(repositoryId)}/archive`,
			{
				method: "POST",
			},
		),
	);
}

export async function fetchRuntimeLatency(
	signal?: AbortSignal,
): Promise<BrowserLatencyResponse> {
	return parseJsonResponse(
		await fetch("/api/latency", {
			cache: "no-store",
			signal,
		}),
	);
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

export async function fetchAgentGraph(
	agentId: string,
): Promise<BrowserGraphResponse> {
	return parseJsonResponse(
		await fetch(`/api/agents/${encodeURIComponent(agentId)}/graph`),
	);
}

export async function fetchAgentWorkspaceFiles(
	agentId: string,
): Promise<WorkspaceFileEntry[]> {
	return parseJsonResponse(
		await fetch(`/api/agents/${encodeURIComponent(agentId)}/workspace-files`),
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

export async function writeAgentFile(
	agentId: string,
	path: string,
	content: string,
	expected: { mtimeMs: number; sha256: string },
): Promise<BrowserFileResponse> {
	const url = new URL(
		`/api/agents/${encodeURIComponent(agentId)}/file`,
		window.location.origin,
	);
	url.searchParams.set("path", path);
	const response = await fetch(url, {
		method: "PUT",
		headers: {
			"content-type": "application/json",
		},
		body: JSON.stringify({
			content,
			expectedMtimeMs: expected.mtimeMs,
			expectedSha256: expected.sha256,
		}),
	});

	if (response.status === 409) {
		const conflictBody = (await response.json().catch(() => undefined)) as
			| { kind?: string; current?: BrowserFileResponse }
			| undefined;
		if (conflictBody?.kind === "conflict" && conflictBody.current) {
			throw new FileConflictError(conflictBody.current);
		}
	}

	return parseJsonResponse(response);
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
