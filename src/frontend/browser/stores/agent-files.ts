import { create } from "zustand";
import type { WorkspaceFileEntry } from "../../../common/protocol.ts";
import { fetchAgentWorkspaceFiles } from "../lib/api.ts";

interface AgentFilesEntry {
	files: WorkspaceFileEntry[];
	loadedAt: number;
}

export interface AgentFilesState {
	entriesByAgent: Record<string, AgentFilesEntry>;
	loadingAgentId: string | null;
	requestFiles: (agentId: string) => Promise<void>;
	invalidate: (agentId: string) => void;
	getFiles: (agentId: string | null) => WorkspaceFileEntry[];
}

export const useAgentFilesStore = create<AgentFilesState>((set, get) => ({
	entriesByAgent: {},
	loadingAgentId: null,
	getFiles: (agentId) => {
		if (!agentId) {
			return [];
		}
		return get().entriesByAgent[agentId]?.files ?? [];
	},
	invalidate: (agentId) =>
		set((state) => {
			if (!state.entriesByAgent[agentId]) {
				return state;
			}
			const next = { ...state.entriesByAgent };
			delete next[agentId];
			return { entriesByAgent: next };
		}),
	requestFiles: async (agentId) => {
		const state = get();
		if (state.entriesByAgent[agentId] || state.loadingAgentId === agentId) {
			return;
		}

		set({ loadingAgentId: agentId });
		try {
			const files = await fetchAgentWorkspaceFiles(agentId);
			set((current) => ({
				entriesByAgent: {
					...current.entriesByAgent,
					[agentId]: { files, loadedAt: Date.now() },
				},
				loadingAgentId:
					current.loadingAgentId === agentId ? null : current.loadingAgentId,
			}));
		} catch {
			set((current) => ({
				loadingAgentId:
					current.loadingAgentId === agentId ? null : current.loadingAgentId,
			}));
		}
	},
}));
