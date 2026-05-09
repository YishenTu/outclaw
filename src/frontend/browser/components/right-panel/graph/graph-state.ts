import type { BrowserGraphResponse } from "../../../../../common/protocol.ts";

export interface LoadedAgentGraph {
	agentId: string;
	graph: BrowserGraphResponse;
}

export function graphForAgent(
	state: LoadedAgentGraph | null,
	agentId: string,
): BrowserGraphResponse | null {
	return state?.agentId === agentId ? state.graph : null;
}

export function resolveGraphFocusedIds({
	activeFilePath,
	hoveredId,
	nodeIds,
}: {
	activeFilePath: string | null;
	hoveredId: string | null;
	nodeIds: ReadonlySet<string>;
}): Set<string> {
	const focusedIds = new Set<string>();
	if (hoveredId && nodeIds.has(hoveredId)) {
		focusedIds.add(hoveredId);
	}
	if (activeFilePath && nodeIds.has(activeFilePath)) {
		focusedIds.add(activeFilePath);
	}
	return focusedIds;
}
