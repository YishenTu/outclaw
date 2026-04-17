import type { UpperRightPanelTab } from "./right-panel-layout.ts";

interface TreeFetchParams {
	activeAgentId: string | null;
	activeUpperTab: UpperRightPanelTab;
	loadedAgentId: string | null;
	loadedRevision: number | null;
	treeRevision: number;
}

interface GitFetchParams {
	activeUpperTab: UpperRightPanelTab;
	gitRevision: number;
	loadedRevision: number | null;
}

export function shouldFetchAgentTree(params: TreeFetchParams): boolean {
	if (params.activeUpperTab !== "files") {
		return false;
	}
	if (!params.activeAgentId) {
		return false;
	}
	if (params.loadedAgentId !== params.activeAgentId) {
		return true;
	}
	return params.loadedRevision !== params.treeRevision;
}

export function shouldFetchGitStatus(params: GitFetchParams): boolean {
	if (params.activeUpperTab !== "git") {
		return false;
	}
	return params.loadedRevision !== params.gitRevision;
}
