import { create } from "zustand";
import type { BrowserSidebarInvalidatedEvent } from "../../../common/protocol.ts";

interface RightPanelRefreshState {
	cronRevisionByAgent: Record<string, number>;
	gitRevision: number;
	treeRevisionByAgent: Record<string, number>;

	invalidate: (event: BrowserSidebarInvalidatedEvent) => void;
}

function incrementRevision(
	revisions: Record<string, number>,
	agentId: string,
): Record<string, number> {
	return {
		...revisions,
		[agentId]: (revisions[agentId] ?? 0) + 1,
	};
}

export function createRightPanelRefreshStore() {
	return create<RightPanelRefreshState>((set) => ({
		cronRevisionByAgent: {},
		gitRevision: 0,
		treeRevisionByAgent: {},
		invalidate: (event) =>
			set((state) => {
				let nextCronRevisionByAgent = state.cronRevisionByAgent;
				let nextGitRevision = state.gitRevision;
				let nextTreeRevisionByAgent = state.treeRevisionByAgent;

				for (const section of event.sections) {
					if (section === "git") {
						nextGitRevision += 1;
						continue;
					}

					if (!event.agentId) {
						continue;
					}

					if (section === "tree") {
						nextTreeRevisionByAgent = incrementRevision(
							nextTreeRevisionByAgent,
							event.agentId,
						);
						continue;
					}

					nextCronRevisionByAgent = incrementRevision(
						nextCronRevisionByAgent,
						event.agentId,
					);
				}

				return {
					cronRevisionByAgent: nextCronRevisionByAgent,
					gitRevision: nextGitRevision,
					treeRevisionByAgent: nextTreeRevisionByAgent,
				};
			}),
	}));
}

export const useRightPanelRefreshStore = createRightPanelRefreshStore();
