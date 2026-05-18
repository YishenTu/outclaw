import { useCallback, useEffect, useRef, useState } from "react";
import type {
	BrowserGitStatusResponse,
	BrowserInboxResponse,
	BrowserTreeEntry,
} from "../../../../common/protocol.ts";
import type { UpperRightPanelTab } from "../../layouts/right-panel-layout.ts";
import {
	fetchAgentInbox,
	fetchAgentTree,
	fetchGitStatus,
} from "../../lib/api.ts";
import { useGitHistoryPagination } from "./git/git-history-pagination.ts";
import {
	shouldFetchAgentTree,
	shouldFetchGitStatus,
	shouldFetchInbox,
} from "./right-panel-fetch-policy.ts";
import {
	browserTreeEntriesEqual,
	resolveTreeRefreshFailure,
	shouldShowTreeLoading,
} from "./tree-refresh-policy.ts";

export function useAgentTreeLoader(params: {
	activeAgentId: string | null;
	activeUpperTab: UpperRightPanelTab;
	gitRevision: number;
	treeRevision: number;
}) {
	const [tree, setTree] = useState<BrowserTreeEntry[]>([]);
	const [treeLoading, setTreeLoading] = useState(false);
	const [treeError, setTreeError] = useState<string | null>(null);
	const [loadedTreeAgentId, setLoadedTreeAgentId] = useState<string | null>(
		null,
	);
	const [loadedTreeRevision, setLoadedTreeRevision] = useState<number | null>(
		null,
	);
	const [loadedTreeGitRevision, setLoadedTreeGitRevision] = useState<
		number | null
	>(null);
	const treeRef = useRef<BrowserTreeEntry[]>([]);
	const setVisibleTree = useCallback((entries: BrowserTreeEntry[]) => {
		setTree((current) => {
			if (browserTreeEntriesEqual(current, entries)) {
				treeRef.current = current;
				return current;
			}
			treeRef.current = entries;
			return entries;
		});
	}, []);

	useEffect(() => {
		void params.treeRevision;
		void params.gitRevision;

		if (params.activeUpperTab !== "files") {
			setTreeLoading(false);
			return;
		}

		if (!params.activeAgentId) {
			setVisibleTree([]);
			setTreeError(null);
			setTreeLoading(false);
			setLoadedTreeAgentId(null);
			setLoadedTreeRevision(null);
			setLoadedTreeGitRevision(null);
			return;
		}

		if (
			!shouldFetchAgentTree({
				activeAgentId: params.activeAgentId,
				activeUpperTab: params.activeUpperTab,
				gitRevision: params.gitRevision,
				loadedAgentId: loadedTreeAgentId,
				loadedGitRevision: loadedTreeGitRevision,
				loadedRevision: loadedTreeRevision,
				treeRevision: params.treeRevision,
			})
		) {
			return;
		}

		let cancelled = false;
		const canKeepCurrentTree =
			loadedTreeAgentId === params.activeAgentId && treeRef.current.length > 0;
		if (!canKeepCurrentTree) {
			setVisibleTree([]);
		}
		setTreeLoading(
			shouldShowTreeLoading({
				entries: canKeepCurrentTree ? treeRef.current : [],
				loading: true,
			}),
		);
		setTreeError(null);
		void fetchAgentTree(params.activeAgentId)
			.then((nextTree) => {
				if (!cancelled) {
					setVisibleTree(nextTree);
					setTreeError(null);
					setLoadedTreeAgentId(params.activeAgentId);
					setLoadedTreeRevision(params.treeRevision);
					setLoadedTreeGitRevision(params.gitRevision);
				}
			})
			.catch((error) => {
				if (!cancelled) {
					const failure = resolveTreeRefreshFailure({
						currentTree: treeRef.current,
						errorMessage:
							error instanceof Error
								? error.message
								: "Failed to load file tree",
					});
					setVisibleTree(failure.tree);
					setTreeError(failure.treeError);
					if (failure.tree.length === 0) {
						setLoadedTreeAgentId(params.activeAgentId);
						setLoadedTreeRevision(params.treeRevision);
						setLoadedTreeGitRevision(params.gitRevision);
					}
				}
			})
			.finally(() => {
				if (!cancelled) {
					setTreeLoading(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [
		params.activeAgentId,
		params.activeUpperTab,
		params.gitRevision,
		params.treeRevision,
		loadedTreeAgentId,
		loadedTreeGitRevision,
		loadedTreeRevision,
		setVisibleTree,
	]);

	return {
		tree,
		treeError,
		treeLoading,
	};
}

export function useGitStatusLoader(params: {
	active: boolean;
	gitRevision: number;
	providerId?: string | null;
	repositoryId?: string | null;
	sdkSessionId?: string | null;
	workspaceKey?: string | null;
}) {
	const repositoryId = params.repositoryId ?? null;
	const providerId = params.providerId ?? null;
	const sdkSessionId = params.sdkSessionId ?? null;
	const scopeKey = params.workspaceKey ?? repositoryId;
	const requestParamsRef = useRef<{
		providerId?: string;
		repositoryId?: string;
		sdkSessionId?: string;
	}>({});
	requestParamsRef.current = {
		...(providerId ? { providerId } : {}),
		...(repositoryId ? { repositoryId } : {}),
		...(sdkSessionId ? { sdkSessionId } : {}),
	};
	const [gitStatus, setGitStatus] = useState<BrowserGitStatusResponse | null>(
		null,
	);
	const [gitLoading, setGitLoading] = useState(false);
	const [gitError, setGitError] = useState<string | null>(null);
	const [loadedGitScopeKey, setLoadedGitScopeKey] = useState<string | null>(
		null,
	);
	const [loadedGitRevision, setLoadedGitRevision] = useState<number | null>(
		null,
	);
	const { gitHistoryLoadError, gitHistoryLoadingMore, loadMoreGitHistory } =
		useGitHistoryPagination({
			requestParamsRef,
			setStatus: setGitStatus,
			status: gitStatus,
		});
	const gitStatusNeedsLoad = shouldFetchGitStatus({
		active: params.active,
		gitRevision: params.gitRevision,
		loadedScopeKey: loadedGitScopeKey,
		loadedRevision: loadedGitRevision,
		scopeKey,
	});

	useEffect(() => {
		void params.gitRevision;

		if (!params.active) {
			setGitLoading(false);
			return;
		}

		if (!gitStatusNeedsLoad) {
			return;
		}

		let cancelled = false;
		const requestGitRevision = params.gitRevision;
		const requestScopeKey = scopeKey;
		const requestParams = requestParamsRef.current;
		setGitLoading(true);
		setGitError(null);
		void fetchGitStatus(
			requestParams.repositoryId !== undefined ? requestParams : undefined,
		)
			.then((nextStatus) => {
				if (!cancelled) {
					setGitStatus(nextStatus);
					setGitError(null);
					setLoadedGitScopeKey(requestScopeKey);
					setLoadedGitRevision(requestGitRevision);
				}
			})
			.catch((error) => {
				if (!cancelled) {
					setGitStatus(null);
					setGitError(
						error instanceof Error
							? error.message
							: "Failed to load git status",
					);
					setLoadedGitScopeKey(requestScopeKey);
					setLoadedGitRevision(requestGitRevision);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setGitLoading(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [params.active, params.gitRevision, scopeKey, gitStatusNeedsLoad]);

	const acceptGitStatus = useCallback(
		(nextStatus: BrowserGitStatusResponse) => {
			setGitStatus(nextStatus);
			setGitError(null);
			setLoadedGitScopeKey(scopeKey);
			setLoadedGitRevision(params.gitRevision);
		},
		[params.gitRevision, scopeKey],
	);

	return {
		acceptGitStatus,
		gitError,
		gitHistoryLoadError,
		gitHistoryLoadingMore,
		gitLoading: params.active ? gitLoading || gitStatusNeedsLoad : gitLoading,
		gitStatus: gitStatusNeedsLoad ? null : gitStatus,
		loadMoreGitHistory,
	};
}

export function useInboxLoader(params: {
	activeAgentId: string | null;
	inboxRevision: number;
}) {
	const [inbox, setInbox] = useState<BrowserInboxResponse | null>(null);
	const [inboxLoading, setInboxLoading] = useState(false);
	const [inboxError, setInboxError] = useState<string | null>(null);
	const [loadedInboxAgentId, setLoadedInboxAgentId] = useState<string | null>(
		null,
	);
	const [loadedInboxRevision, setLoadedInboxRevision] = useState<number | null>(
		null,
	);

	useEffect(() => {
		void params.inboxRevision;

		if (!params.activeAgentId) {
			setInbox(null);
			setInboxError(null);
			setInboxLoading(false);
			setLoadedInboxAgentId(null);
			setLoadedInboxRevision(null);
			return;
		}

		if (
			!shouldFetchInbox({
				activeAgentId: params.activeAgentId,
				inboxRevision: params.inboxRevision,
				loadedAgentId: loadedInboxAgentId,
				loadedRevision: loadedInboxRevision,
			})
		) {
			return;
		}

		let cancelled = false;
		setInboxLoading(true);
		setInboxError(null);
		void fetchAgentInbox(params.activeAgentId)
			.then((nextInbox) => {
				if (!cancelled) {
					setInbox(nextInbox);
					setInboxError(null);
					setLoadedInboxAgentId(params.activeAgentId);
					setLoadedInboxRevision(params.inboxRevision);
				}
			})
			.catch((error) => {
				if (!cancelled) {
					setInbox(null);
					setInboxError(
						error instanceof Error ? error.message : "Failed to load inbox",
					);
					setLoadedInboxAgentId(params.activeAgentId);
					setLoadedInboxRevision(params.inboxRevision);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setInboxLoading(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [
		params.activeAgentId,
		params.inboxRevision,
		loadedInboxAgentId,
		loadedInboxRevision,
	]);

	return {
		inbox,
		inboxError,
		inboxLoading,
	};
}
