import { create } from "zustand";
import type { WorkspaceFileEntry } from "../../../common/protocol.ts";
import { fetchAgentWorkspaceFiles } from "../lib/api.ts";

interface AgentFilesEntry {
	files: WorkspaceFileEntry[];
	loadedAt: number;
}

export interface AgentFilesState {
	entriesByAgent: Record<string, AgentFilesEntry>;
	errorByAgent: Record<string, string>;
	loadingByAgent: Record<string, boolean>;
	requestGenerationByAgent: Record<string, number>;
	requestFiles: (agentId: string) => Promise<void>;
	invalidate: (agentId: string) => void;
	getFiles: (agentId: string | null) => WorkspaceFileEntry[];
}

export const useAgentFilesStore = create<AgentFilesState>((set, get) => ({
	entriesByAgent: {},
	errorByAgent: {},
	loadingByAgent: {},
	requestGenerationByAgent: {},
	getFiles: (agentId) => {
		if (!agentId) {
			return [];
		}
		return get().entriesByAgent[agentId]?.files ?? [];
	},
	invalidate: (agentId) =>
		set((state) => ({
			entriesByAgent: omitRecordKey(state.entriesByAgent, agentId),
			errorByAgent: omitRecordKey(state.errorByAgent, agentId),
			loadingByAgent: omitRecordKey(state.loadingByAgent, agentId),
			requestGenerationByAgent: {
				...state.requestGenerationByAgent,
				[agentId]: (state.requestGenerationByAgent[agentId] ?? 0) + 1,
			},
		})),
	requestFiles: async (agentId) => {
		const state = get();
		if (state.entriesByAgent[agentId] || state.loadingByAgent[agentId]) {
			return;
		}

		const generation = (state.requestGenerationByAgent[agentId] ?? 0) + 1;
		set((current) => ({
			errorByAgent: omitRecordKey(current.errorByAgent, agentId),
			loadingByAgent: { ...current.loadingByAgent, [agentId]: true },
			requestGenerationByAgent: {
				...current.requestGenerationByAgent,
				[agentId]: generation,
			},
		}));
		try {
			const files = await fetchAgentWorkspaceFiles(agentId);
			set((current) => {
				if (current.requestGenerationByAgent[agentId] !== generation) {
					return current;
				}
				return {
					entriesByAgent: {
						...current.entriesByAgent,
						[agentId]: { files, loadedAt: Date.now() },
					},
					loadingByAgent: omitRecordKey(current.loadingByAgent, agentId),
				};
			});
		} catch (error) {
			set((current) => {
				if (current.requestGenerationByAgent[agentId] !== generation) {
					return current;
				}
				return {
					errorByAgent: {
						...current.errorByAgent,
						[agentId]: error instanceof Error ? error.message : String(error),
					},
					loadingByAgent: omitRecordKey(current.loadingByAgent, agentId),
				};
			});
		}
	},
}));

function omitRecordKey<T>(
	record: Record<string, T>,
	key: string,
): Record<string, T> {
	if (!(key in record)) {
		return record;
	}
	const next = { ...record };
	delete next[key];
	return next;
}
