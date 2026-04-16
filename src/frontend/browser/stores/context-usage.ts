import { create } from "zustand";
import type { UsageInfo } from "../../../common/protocol.ts";

export interface ContextUsageState {
	usage: Record<string, UsageInfo>;

	setUsage: (sessionId: string, usage: UsageInfo) => void;
	getUsage: (sessionId: string) => UsageInfo | undefined;
}

export const useContextUsageStore = create<ContextUsageState>((set, get) => ({
	usage: {},
	setUsage: (sessionId, usage) =>
		set((state) => ({
			usage: {
				...state.usage,
				[sessionId]: usage,
			},
		})),
	getUsage: (sessionId) => get().usage[sessionId],
}));
