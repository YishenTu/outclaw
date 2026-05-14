import type { EffortLevel } from "../../../common/commands.ts";
import type {
	BrowserAgentsResponse,
	BrowserCodingFolderPickerResponse,
	BrowserCodingModelsResponse,
	BrowserCodingRepositoryArchiveResponse,
	BrowserCodingRepositoryCloneResponse,
	BrowserCodingRepositoryDetail,
	BrowserCodingRepositoryListResponse,
	BrowserCodingRepositoryRestoreResponse,
	BrowserCodingSessionArchiveResponse,
	BrowserCodingSessionDeleteResponse,
	BrowserCodingSessionDetail,
	BrowserCodingSessionEvent,
	BrowserCodingSessionLifecycleStatus,
	BrowserCodingSessionLinksResponse,
	BrowserCodingSessionPageResponse,
	BrowserCodingSessionRestoreResponse,
	BrowserCodingSessionResumeResponse,
	BrowserCodingSessionStartResponse,
	BrowserCodingSessionStopResponse,
	BrowserCodingSkillsResponse,
	BrowserConfigResponse,
	BrowserCronEntry,
	BrowserCronHistoryCursor,
	BrowserCronHistoryResponse,
	BrowserFileResponse,
	BrowserGitCommitResponse,
	BrowserGitCommitStats,
	BrowserGitDiffResponse,
	BrowserGitHistory,
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

export type FileSource =
	| { kind: "agent"; agentId: string }
	| { kind: "repository"; repositoryId: string };

export function fileSourceKey(source: FileSource): string {
	return source.kind === "agent"
		? `agent:${source.agentId}`
		: `repository:${source.repositoryId}`;
}

export function fetchFileFromSource(
	source: FileSource,
	path: string,
): Promise<BrowserFileResponse> {
	return source.kind === "agent"
		? fetchAgentFile(source.agentId, path)
		: fetchCodingRepositoryFile(source.repositoryId, path);
}

export function writeFileToSource(
	source: FileSource,
	path: string,
	content: string,
	expected: { mtimeMs: number; sha256: string },
): Promise<BrowserFileResponse> {
	return source.kind === "agent"
		? writeAgentFile(source.agentId, path, content, expected)
		: writeCodingRepositoryFile(source.repositoryId, path, content, expected);
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

export async function fetchCodingSessions(params: {
	limit: number;
	cursor?: SessionCursor;
	linkedChatSessionId?: string;
	lifecycleStatus?: BrowserCodingSessionLifecycleStatus;
	providerId?: string;
	query?: string;
	repositoryId?: string;
}): Promise<BrowserCodingSessionPageResponse> {
	const url = new URL("/api/coding/sessions", window.location.origin);
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
	if (params.linkedChatSessionId) {
		url.searchParams.set("linkedChatSessionId", params.linkedChatSessionId);
	}
	if (params.lifecycleStatus) {
		url.searchParams.set("lifecycleStatus", params.lifecycleStatus);
	}
	if (params.query?.trim()) {
		url.searchParams.set("query", params.query.trim());
	}
	return parseJsonResponse(await fetch(url));
}

export async function fetchCodingSession(
	providerId: string,
	sdkSessionId: string,
): Promise<BrowserCodingSessionDetail> {
	return parseJsonResponse(
		await fetch(
			`/api/coding/sessions/${encodeURIComponent(providerId)}/${encodeURIComponent(sdkSessionId)}`,
		),
	);
}

export async function fetchChatCodingSessions(params: {
	agentId: string;
	providerId: string;
	sdkSessionId: string;
}): Promise<BrowserCodingSessionLinksResponse> {
	return parseJsonResponse(
		await fetch(
			`/api/agents/${encodeURIComponent(params.agentId)}/sessions/${encodeURIComponent(params.providerId)}/${encodeURIComponent(params.sdkSessionId)}/coding-links`,
		),
	);
}

export async function archiveCodingSession(
	providerId: string,
	sdkSessionId: string,
): Promise<BrowserCodingSessionArchiveResponse> {
	return parseJsonResponse(
		await fetch(
			`/api/coding/sessions/${encodeURIComponent(providerId)}/${encodeURIComponent(sdkSessionId)}/archive`,
			{
				method: "POST",
			},
		),
	);
}

export async function deleteCodingSession(
	providerId: string,
	sdkSessionId: string,
): Promise<BrowserCodingSessionDeleteResponse> {
	return parseJsonResponse(
		await fetch(
			`/api/coding/sessions/${encodeURIComponent(providerId)}/${encodeURIComponent(sdkSessionId)}`,
			{
				method: "DELETE",
			},
		),
	);
}

export async function restoreCodingSession(
	providerId: string,
	sdkSessionId: string,
): Promise<BrowserCodingSessionRestoreResponse> {
	return parseJsonResponse(
		await fetch(
			`/api/coding/sessions/${encodeURIComponent(providerId)}/${encodeURIComponent(sdkSessionId)}/restore`,
			{
				method: "POST",
			},
		),
	);
}

export async function renameCodingSession(
	providerId: string,
	sdkSessionId: string,
	title: string,
): Promise<BrowserCodingSessionDetail> {
	return parseJsonResponse(
		await fetch(
			`/api/coding/sessions/${encodeURIComponent(providerId)}/${encodeURIComponent(sdkSessionId)}`,
			{
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ title }),
			},
		),
	);
}

export async function startCodingSession(params: {
	repositoryId?: string;
	cwd?: string;
	prompt: string;
	linkedChatSessionId?: string;
	model?: string;
	effort?: EffortLevel;
	serviceTier?: string;
}): Promise<BrowserCodingSessionStartResponse> {
	return parseJsonResponse(
		await fetch("/api/coding/sessions", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(params),
		}),
	);
}

export async function resumeCodingSession(params: {
	providerId: string;
	sdkSessionId: string;
	prompt: string;
	model?: string;
	effort?: EffortLevel;
	serviceTier?: string;
}): Promise<BrowserCodingSessionResumeResponse> {
	return parseJsonResponse(
		await fetch(
			`/api/coding/sessions/${encodeURIComponent(params.providerId)}/${encodeURIComponent(params.sdkSessionId)}/resume`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					prompt: params.prompt,
					...(params.model ? { model: params.model } : {}),
					...(params.effort ? { effort: params.effort } : {}),
					...(params.serviceTier ? { serviceTier: params.serviceTier } : {}),
				}),
			},
		),
	);
}

export async function stopCodingSession(params: {
	providerId: string;
	sdkSessionId: string;
}): Promise<BrowserCodingSessionStopResponse> {
	return parseJsonResponse(
		await fetch(
			`/api/coding/sessions/${encodeURIComponent(params.providerId)}/${encodeURIComponent(params.sdkSessionId)}/stop`,
			{
				method: "POST",
			},
		),
	);
}

export async function fetchCodingModels(): Promise<BrowserCodingModelsResponse> {
	return parseJsonResponse(await fetch("/api/coding/models"));
}

export async function fetchCodingRepositorySkills(
	repositoryId: string,
	params: { forceReload?: boolean } = {},
): Promise<BrowserCodingSkillsResponse> {
	const url = new URL(
		`/api/coding/repositories/${encodeURIComponent(repositoryId)}/skills`,
		window.location.origin,
	);
	if (params.forceReload) {
		url.searchParams.set("forceReload", "true");
	}
	return parseJsonResponse(await fetch(url));
}

export type CodingSessionEventStreamItem = BrowserCodingSessionEvent;

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

export async function pickCodingRepositoryFolder(): Promise<BrowserCodingFolderPickerResponse> {
	return parseJsonResponse(
		await fetch("/api/coding/folder-picker", {
			method: "POST",
		}),
	);
}

export async function registerCodingRepository(params: {
	displayName?: string;
	remoteUrl?: string;
	rootCwd: string;
	source?: "manual" | "clone";
}): Promise<BrowserCodingRepositoryDetail> {
	return parseJsonResponse(
		await fetch("/api/coding/repositories", {
			method: "POST",
			headers: {
				"content-type": "application/json",
			},
			body: JSON.stringify(params),
		}),
	);
}

export async function cloneCodingRepository(params: {
	remoteUrl: string;
	parentDir: string;
	displayName?: string;
}): Promise<BrowserCodingRepositoryCloneResponse> {
	return parseJsonResponse(
		await fetch("/api/coding/repositories/clone", {
			method: "POST",
			headers: {
				"content-type": "application/json",
			},
			body: JSON.stringify(params),
		}),
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

export async function restoreCodingRepository(
	repositoryId: string,
): Promise<BrowserCodingRepositoryRestoreResponse> {
	return parseJsonResponse(
		await fetch(
			`/api/coding/repositories/${encodeURIComponent(repositoryId)}/restore`,
			{
				method: "POST",
			},
		),
	);
}

export async function updateCodingRepositoryTerminalRunCommand(
	repositoryId: string,
	command: string,
): Promise<BrowserTerminalRunCommandResponse> {
	return parseJsonResponse(
		await fetch(
			`/api/coding/repositories/${encodeURIComponent(repositoryId)}/terminal-run-command`,
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

export async function fetchCodingRepositoryTree(
	repositoryId: string,
	path?: string,
	params?: { providerId?: string; sdkSessionId?: string },
): Promise<BrowserTreeEntry[]> {
	const url = new URL(
		`/api/coding/repositories/${encodeURIComponent(repositoryId)}/tree`,
		window.location.origin,
	);
	if (path) {
		url.searchParams.set("path", path);
	}
	appendCodingWorkspaceParams(url, params);
	return parseJsonResponse(await fetch(url));
}

export async function fetchCodingRepositoryWorkspaceFiles(
	repositoryId: string,
): Promise<WorkspaceFileEntry[]> {
	return parseJsonResponse(
		await fetch(
			`/api/coding/repositories/${encodeURIComponent(repositoryId)}/workspace-files`,
		),
	);
}

export async function fetchCodingRepositoryFile(
	repositoryId: string,
	path: string,
): Promise<BrowserFileResponse> {
	const url = new URL(
		`/api/coding/repositories/${encodeURIComponent(repositoryId)}/files`,
		window.location.origin,
	);
	url.searchParams.set("path", path);
	return parseJsonResponse(await fetch(url));
}

export async function writeCodingRepositoryFile(
	repositoryId: string,
	path: string,
	content: string,
	expected: { mtimeMs: number; sha256: string },
): Promise<BrowserFileResponse> {
	const url = new URL(
		`/api/coding/repositories/${encodeURIComponent(repositoryId)}/files`,
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

function appendCodingWorkspaceParams(
	url: URL,
	params?: { providerId?: string; sdkSessionId?: string },
): URL {
	if (params?.providerId) {
		url.searchParams.set("providerId", params.providerId);
	}
	if (params?.sdkSessionId) {
		url.searchParams.set("sdkSessionId", params.sdkSessionId);
	}
	return url;
}

function appendGitScopeParams(
	url: URL,
	params?: {
		providerId?: string;
		repositoryId?: string;
		sdkSessionId?: string;
	},
): URL {
	if (params?.repositoryId) {
		url.searchParams.set("repositoryId", params.repositoryId);
	}
	appendCodingWorkspaceParams(url, params);
	return url;
}

export async function fetchGitStatus(params?: {
	providerId?: string;
	repositoryId?: string;
	sdkSessionId?: string;
}): Promise<BrowserGitStatusResponse> {
	const url = appendGitScopeParams(
		new URL("/api/git/status", window.location.origin),
		params,
	);
	return parseJsonResponse(await fetch(url));
}

export async function fetchGitHistory(params?: {
	cursor?: string;
	limit?: number;
	providerId?: string;
	repositoryId?: string;
	sdkSessionId?: string;
}): Promise<BrowserGitHistory> {
	const url = appendGitScopeParams(
		new URL("/api/git/history", window.location.origin),
		params,
	);
	if (params?.cursor) {
		url.searchParams.set("cursor", params.cursor);
	}
	if (params?.limit !== undefined) {
		url.searchParams.set("limit", String(params.limit));
	}
	return parseJsonResponse(await fetch(url));
}

export async function initGitRepo(params?: {
	providerId?: string;
	repositoryId?: string;
	sdkSessionId?: string;
}): Promise<BrowserGitStatusResponse> {
	const url = appendGitScopeParams(
		new URL("/api/git/init", window.location.origin),
		params,
	);
	return parseJsonResponse(
		await fetch(url, {
			method: "POST",
		}),
	);
}

export async function fetchGitDiff(
	path: string,
	params?: {
		providerId?: string;
		repositoryId?: string;
		sdkSessionId?: string;
	},
): Promise<BrowserGitDiffResponse> {
	const url = appendGitScopeParams(
		new URL("/api/git/diff", window.location.origin),
		params,
	);
	url.searchParams.set("path", path);
	return parseJsonResponse(await fetch(url));
}

export async function fetchGitCommit(
	sha: string,
	params?: {
		providerId?: string;
		repositoryId?: string;
		sdkSessionId?: string;
	},
): Promise<BrowserGitCommitResponse> {
	const url = appendGitScopeParams(
		new URL("/api/git/commit", window.location.origin),
		params,
	);
	url.searchParams.set("sha", sha);
	return parseJsonResponse(await fetch(url));
}

export async function fetchGitCommitStats(
	sha: string,
	params?: {
		providerId?: string;
		repositoryId?: string;
		sdkSessionId?: string;
	},
): Promise<BrowserGitCommitStats> {
	const url = appendGitScopeParams(
		new URL("/api/git/commit/stats", window.location.origin),
		params,
	);
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
