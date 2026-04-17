import { create } from "zustand";
import type {
	FrontendNotice,
	RuntimeStatusEvent,
	UsageInfo,
} from "../../../common/protocol.ts";

export type BrowserConnectionStatus =
	| "connecting"
	| "connected"
	| "disconnected";

export interface BrowserRuntimeState {
	connectionStatus: BrowserConnectionStatus;
	error: string | null;
	agentName: string | null;
	providerId: string | null;
	model: string | null;
	effort: string | null;
	sessionId: string | null;
	sessionTitle: string | null;
	notice: FrontendNotice | null;
	usage: UsageInfo | undefined;
	nextHeartbeatAt: number | undefined;
	heartbeatDeferred: boolean;

	setConnectionStatus: (status: BrowserConnectionStatus) => void;
	setError: (error: string | null) => void;
	updateFromStatus: (event: RuntimeStatusEvent) => void;
	setAgentName: (name: string | null) => void;
	setModel: (model: string) => void;
	setEffort: (effort: string) => void;
	clearSession: () => void;
}

export const useRuntimeStore = create<BrowserRuntimeState>((set) => ({
	connectionStatus: "connecting",
	error: null,
	agentName: null,
	providerId: null,
	model: null,
	effort: null,
	sessionId: null,
	sessionTitle: null,
	notice: null,
	usage: undefined,
	nextHeartbeatAt: undefined,
	heartbeatDeferred: false,
	setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
	setError: (error) => set({ error }),
	updateFromStatus: (event) =>
		set((state) => ({
			agentName: event.agentName ?? state.agentName,
			providerId: event.providerId ?? state.providerId,
			model: event.model,
			effort: event.effort,
			sessionId: event.sessionId ?? null,
			sessionTitle: event.sessionTitle ?? null,
			notice: event.notice ?? null,
			usage: event.usage,
			nextHeartbeatAt: event.nextHeartbeatAt,
			heartbeatDeferred: event.heartbeatDeferred ?? false,
		})),
	setAgentName: (agentName) => set({ agentName }),
	setModel: (model) => set({ model }),
	setEffort: (effort) => set({ effort }),
	clearSession: () =>
		set({
			sessionId: null,
			sessionTitle: null,
			usage: undefined,
			nextHeartbeatAt: undefined,
			heartbeatDeferred: false,
		}),
}));
