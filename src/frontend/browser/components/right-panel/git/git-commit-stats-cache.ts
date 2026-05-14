import type { BrowserGitCommitStats } from "../../../../../common/protocol.ts";
import { fetchGitCommitStats } from "../../../lib/api.ts";

const statsRequests = new Map<string, Promise<BrowserGitCommitStats>>();

export interface GitCommitStatsScope {
	providerId?: string;
	repositoryId?: string;
	sdkSessionId?: string;
	workspaceKey?: string;
}

function cacheKey({
	repositoryId,
	sha,
	workspaceKey,
}: {
	repositoryId?: string;
	sha: string;
	workspaceKey?: string;
}): string {
	return `${workspaceKey ?? repositoryId ?? ""}:${sha}`;
}

export function readCachedGitCommitStats({
	providerId,
	repositoryId,
	sha,
	sdkSessionId,
	workspaceKey,
}: GitCommitStatsScope & {
	sha: string;
}): Promise<BrowserGitCommitStats> {
	const key = cacheKey({ repositoryId, sha, workspaceKey });
	const cached = statsRequests.get(key);
	if (cached) {
		return cached;
	}

	const request = fetchGitCommitStats(
		sha,
		repositoryId
			? {
					repositoryId,
					...(providerId ? { providerId } : {}),
					...(sdkSessionId ? { sdkSessionId } : {}),
				}
			: undefined,
	).catch((error: unknown) => {
		statsRequests.delete(key);
		throw error;
	});
	statsRequests.set(key, request);
	return request;
}

export function prefetchGitCommitStats(params: {
	providerId?: string;
	repositoryId?: string;
	sdkSessionId?: string;
	sha: string;
	workspaceKey?: string;
}): void {
	void readCachedGitCommitStats(params).catch(() => {});
}

export function clearGitCommitStatsCacheForTests(): void {
	statsRequests.clear();
}
