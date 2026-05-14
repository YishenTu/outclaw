import {
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import type {
	BrowserGitHistory,
	BrowserGitStatusResponse,
} from "../../../../../common/protocol.ts";
import { fetchGitHistory } from "../../../lib/api.ts";

export function appendGitHistoryPage(
	current: BrowserGitStatusResponse | null,
	expectedCursor: string,
	page: BrowserGitHistory,
): BrowserGitStatusResponse | null {
	if (!current?.initialized || current.history.nextCursor !== expectedCursor) {
		return current;
	}

	const seenShas = new Set(current.history.commits.map((commit) => commit.sha));
	const commits = [
		...current.history.commits,
		...page.commits.filter((commit) => !seenShas.has(commit.sha)),
	];

	return {
		...current,
		history: {
			commits,
			...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
		},
	};
}

export function useGitHistoryPagination({
	requestParamsRef,
	setStatus,
	status,
}: {
	requestParamsRef: RefObject<{
		providerId?: string;
		repositoryId?: string;
		sdkSessionId?: string;
	}>;
	setStatus: (
		updater: (
			current: BrowserGitStatusResponse | null,
		) => BrowserGitStatusResponse | null,
	) => void;
	status: BrowserGitStatusResponse | null;
}): {
	gitHistoryLoadError: string | null;
	gitHistoryLoadingMore: boolean;
	loadMoreGitHistory: () => void;
} {
	const loadingMoreRef = useRef(false);
	const [gitHistoryLoadingMore, setGitHistoryLoadingMore] = useState(false);
	const [gitHistoryLoadError, setGitHistoryLoadError] = useState<string | null>(
		null,
	);
	const previousStatusRef = useRef(status);

	useEffect(() => {
		if (previousStatusRef.current === status) {
			return;
		}
		previousStatusRef.current = status;
		setGitHistoryLoadError(null);
	});

	const loadMoreGitHistory = useCallback(() => {
		if (
			!status?.initialized ||
			!status.history.nextCursor ||
			loadingMoreRef.current
		) {
			return;
		}

		const cursor = status.history.nextCursor;
		const root = status.root;
		loadingMoreRef.current = true;
		setGitHistoryLoadingMore(true);
		setGitHistoryLoadError(null);
		const requestParams = requestParamsRef.current;

		void fetchGitHistory({
			...requestParams,
			cursor,
		})
			.then((page) => {
				setStatus((current) => {
					if (!current?.initialized || current.root !== root) {
						return current;
					}
					return appendGitHistoryPage(current, cursor, page);
				});
			})
			.catch((error) => {
				setGitHistoryLoadError(
					error instanceof Error
						? error.message
						: "Failed to load commit history",
				);
			})
			.finally(() => {
				loadingMoreRef.current = false;
				setGitHistoryLoadingMore(false);
			});
	}, [requestParamsRef, setStatus, status]);

	return {
		gitHistoryLoadError,
		gitHistoryLoadingMore,
		loadMoreGitHistory,
	};
}
