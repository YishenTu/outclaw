import { create } from "zustand";
import type {
	FrontendNotice,
	RuntimeStatusEvent,
	UsageInfo,
} from "../../../common/protocol.ts";
import { createRuntimeNoticeKey } from "../notices/runtime-notice-projection.ts";

export type BrowserConnectionStatus =
	| "connecting"
	| "connected"
	| "disconnected";

export type BrowserRuntimeLatency =
	| {
			rttMs: number | null;
			status: "idle" | "measuring";
	  }
	| {
			rttMs: number;
			status: "ready";
	  }
	| {
			rttMs: null;
			status: "error" | "timeout";
	  };

export interface BrowserRuntimeState {
	connectionStatus: BrowserConnectionStatus;
	dismissedNoticeKey: string | null;
	error: string | null;
	latency: BrowserRuntimeLatency;
	agentName: string | null;
	providerId: string | null;
	model: string | null;
	effort: string | null;
	running: boolean;
	sessionId: string | null;
	sessionTitle: string | null;
	notice: FrontendNotice | null;
	usage: UsageInfo | undefined;
	nextHeartbeatAt: number | undefined;
	heartbeatDeferred: boolean;

	setConnectionStatus: (status: BrowserConnectionStatus) => void;
	setLatency: (latency: BrowserRuntimeLatency) => void;
	dismissNotice: () => void;
	setError: (error: string | null) => void;
	updateFromStatus: (event: RuntimeStatusEvent) => void;
	setAgentName: (name: string | null) => void;
	setModel: (model: string) => void;
	setEffort: (effort: string) => void;
	clearSession: () => void;
}

export function selectVisibleRuntimeNotice(
	state: Pick<BrowserRuntimeState, "dismissedNoticeKey" | "notice">,
): FrontendNotice | null {
	const noticeKey = createRuntimeNoticeKey(state.notice);
	if (!noticeKey || noticeKey === state.dismissedNoticeKey) {
		return null;
	}
	return state.notice;
}

export const useRuntimeStore = create<BrowserRuntimeState>((set) => ({
	connectionStatus: "connecting",
	dismissedNoticeKey: null,
	error: null,
	latency: {
		rttMs: null,
		status: "idle",
	},
	agentName: null,
	providerId: null,
	model: null,
	effort: null,
	running: false,
	sessionId: null,
	sessionTitle: null,
	notice: null,
	usage: undefined,
	nextHeartbeatAt: undefined,
	heartbeatDeferred: false,
	setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
	setLatency: (latency) => set({ latency }),
	dismissNotice: () =>
		set((state) => ({
			dismissedNoticeKey:
				createRuntimeNoticeKey(state.notice) ?? state.dismissedNoticeKey,
		})),
	setError: (error) => set({ error }),
	updateFromStatus: (event) =>
		set((state) => {
			const notice = event.notice ?? null;
			const noticeKey = createRuntimeNoticeKey(notice);
			return {
				agentName: event.agentName ?? state.agentName,
				providerId: event.providerId ?? state.providerId,
				model: event.model,
				effort: event.effort,
				running: event.running,
				sessionId: event.sessionId ?? null,
				sessionTitle: event.sessionTitle ?? null,
				notice,
				dismissedNoticeKey:
					noticeKey && noticeKey === state.dismissedNoticeKey
						? state.dismissedNoticeKey
						: null,
				usage: event.usage,
				nextHeartbeatAt: event.nextHeartbeatAt,
				heartbeatDeferred: event.heartbeatDeferred ?? false,
			};
		}),
	setAgentName: (agentName) => set({ agentName }),
	setModel: (model) => set({ model }),
	setEffort: (effort) => set({ effort }),
	clearSession: () =>
		set({
			sessionId: null,
			sessionTitle: null,
			running: false,
			usage: undefined,
			nextHeartbeatAt: undefined,
			heartbeatDeferred: false,
		}),
}));
