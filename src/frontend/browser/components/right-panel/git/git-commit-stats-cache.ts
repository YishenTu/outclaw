import type { BrowserGitCommitStats } from "../../../../../common/protocol.ts";
import { fetchGitCommitStats } from "../../../lib/api.ts";

const statsRequests = new Map<string, Promise<BrowserGitCommitStats>>();

function cacheKey({
	repositoryId,
	sha,
}: {
	repositoryId?: string;
	sha: string;
}): string {
	return `${repositoryId ?? ""}:${sha}`;
}

export function readCachedGitCommitStats({
	repositoryId,
	sha,
}: {
	repositoryId?: string;
	sha: string;
}): Promise<BrowserGitCommitStats> {
	const key = cacheKey({ repositoryId, sha });
	const cached = statsRequests.get(key);
	if (cached) {
		return cached;
	}

	const request = fetchGitCommitStats(
		sha,
		repositoryId ? { repositoryId } : undefined,
	).catch((error: unknown) => {
		statsRequests.delete(key);
		throw error;
	});
	statsRequests.set(key, request);
	return request;
}

export function prefetchGitCommitStats(params: {
	repositoryId?: string;
	sha: string;
}): void {
	void readCachedGitCommitStats(params).catch(() => {});
}

export function clearGitCommitStatsCacheForTests(): void {
	statsRequests.clear();
}
