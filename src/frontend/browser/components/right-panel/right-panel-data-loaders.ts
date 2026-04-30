import { useEffect, useState } from "react";
import type {
	BrowserGitStatusResponse,
	BrowserTreeEntry,
} from "../../../../common/protocol.ts";
import { fetchAgentTree, fetchGitStatus } from "../../lib/api.ts";
import {
	shouldFetchAgentTree,
	shouldFetchGitStatus,
} from "./right-panel-fetch-policy.ts";
import type { UpperRightPanelTab } from "./right-panel-layout.ts";

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

	useEffect(() => {
		void params.treeRevision;
		void params.gitRevision;

		if (params.activeUpperTab !== "files") {
			setTreeLoading(false);
			return;
		}

		if (!params.activeAgentId) {
			setTree([]);
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
		setTreeLoading(true);
		setTreeError(null);
		void fetchAgentTree(params.activeAgentId)
			.then((nextTree) => {
				if (!cancelled) {
					setTree(nextTree);
					setTreeError(null);
					setLoadedTreeAgentId(params.activeAgentId);
					setLoadedTreeRevision(params.treeRevision);
					setLoadedTreeGitRevision(params.gitRevision);
				}
			})
			.catch((error) => {
				if (!cancelled) {
					setTree([]);
					setTreeError(
						error instanceof Error ? error.message : "Failed to load file tree",
					);
					setLoadedTreeAgentId(params.activeAgentId);
					setLoadedTreeRevision(params.treeRevision);
					setLoadedTreeGitRevision(params.gitRevision);
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
	]);

	return {
		tree,
		treeError,
		treeLoading,
	};
}

export function useGitStatusLoader(params: {
	activeUpperTab: UpperRightPanelTab;
	gitRevision: number;
}) {
	const [gitStatus, setGitStatus] = useState<BrowserGitStatusResponse | null>(
		null,
	);
	const [gitLoading, setGitLoading] = useState(false);
	const [gitError, setGitError] = useState<string | null>(null);
	const [loadedGitRevision, setLoadedGitRevision] = useState<number | null>(
		null,
	);

	useEffect(() => {
		void params.gitRevision;

		if (params.activeUpperTab !== "git") {
			setGitLoading(false);
			return;
		}

		if (
			!shouldFetchGitStatus({
				activeUpperTab: params.activeUpperTab,
				gitRevision: params.gitRevision,
				loadedRevision: loadedGitRevision,
			})
		) {
			return;
		}

		let cancelled = false;
		setGitLoading(true);
		setGitError(null);
		void fetchGitStatus()
			.then((nextStatus) => {
				if (!cancelled) {
					setGitStatus(nextStatus);
					setGitError(null);
					setLoadedGitRevision(params.gitRevision);
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
					setLoadedGitRevision(params.gitRevision);
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
	}, [params.activeUpperTab, params.gitRevision, loadedGitRevision]);

	return {
		gitError,
		gitLoading,
		gitStatus,
	};
}
