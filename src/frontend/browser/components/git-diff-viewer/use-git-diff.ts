import { useEffect, useState } from "react";
import type { BrowserGitDiffResponse } from "../../../../common/protocol.ts";
import { fetchGitDiff } from "../../lib/api.ts";
import {
	selectGitRevision,
	useRightPanelRefreshStore,
} from "../../stores/right-panel-refresh.ts";

export function useGitDiff(
	path: string | null,
	options?: { repositoryId?: string },
): {
	diff: BrowserGitDiffResponse | null;
	loading: boolean;
	error: string | null;
} {
	const repositoryId = options?.repositoryId;
	const [diff, setDiff] = useState<BrowserGitDiffResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(() => Boolean(path));
	const gitRevision = useRightPanelRefreshStore(selectGitRevision);

	useEffect(() => {
		void gitRevision;

		let cancelled = false;

		if (!path) {
			setDiff(null);
			setError(null);
			setLoading(false);
			return () => {
				cancelled = true;
			};
		}

		setLoading(true);
		setError(null);

		void fetchGitDiff(path, repositoryId ? { repositoryId } : undefined)
			.then((nextDiff) => {
				if (!cancelled) {
					setDiff(nextDiff);
				}
			})
			.catch((nextError) => {
				if (!cancelled) {
					setDiff(null);
					setError(
						nextError instanceof Error
							? nextError.message
							: "Failed to load diff",
					);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setLoading(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [gitRevision, path, repositoryId]);

	return { diff, loading, error };
}
