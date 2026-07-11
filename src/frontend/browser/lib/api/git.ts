import type {
	BrowserGitCommitResponse,
	BrowserGitCommitStats,
	BrowserGitDiffResponse,
	BrowserGitHistory,
	BrowserGitStatusResponse,
} from "../../../../common/protocol.ts";
import { parseJsonResponse } from "../http-client.ts";

interface GitScopeParams {
	providerId?: string;
	repositoryId?: string;
	sdkSessionId?: string;
}

function appendGitScopeParams(url: URL, params?: GitScopeParams): URL {
	if (params?.repositoryId) {
		url.searchParams.set("repositoryId", params.repositoryId);
	}
	if (params?.providerId) {
		url.searchParams.set("providerId", params.providerId);
	}
	if (params?.sdkSessionId) {
		url.searchParams.set("sdkSessionId", params.sdkSessionId);
	}
	return url;
}

export async function fetchGitStatus(
	params?: GitScopeParams,
): Promise<BrowserGitStatusResponse> {
	const url = appendGitScopeParams(
		new URL("/api/git/status", window.location.origin),
		params,
	);
	return parseJsonResponse(await fetch(url));
}

export async function fetchGitHistory(
	params?: GitScopeParams & { cursor?: string; limit?: number },
): Promise<BrowserGitHistory> {
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

export async function initGitRepo(
	params?: GitScopeParams,
): Promise<BrowserGitStatusResponse> {
	const url = appendGitScopeParams(
		new URL("/api/git/init", window.location.origin),
		params,
	);
	return parseJsonResponse(await fetch(url, { method: "POST" }));
}

export async function fetchGitDiff(
	path: string,
	params?: GitScopeParams,
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
	params?: GitScopeParams,
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
	params?: GitScopeParams,
): Promise<BrowserGitCommitStats> {
	const url = appendGitScopeParams(
		new URL("/api/git/commit/stats", window.location.origin),
		params,
	);
	url.searchParams.set("sha", sha);
	return parseJsonResponse(await fetch(url));
}
