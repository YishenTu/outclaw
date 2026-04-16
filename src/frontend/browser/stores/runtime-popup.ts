import { create } from "zustand";
import type {
	AgentMenuEvent,
	SessionMenuEvent,
} from "../../../common/protocol.ts";

export type BrowserRuntimePopup =
	| {
			kind: "agent";
			activeAgentId: string;
			activeAgentName: string;
			agents: AgentMenuEvent["agents"];
	  }
	| {
			kind: "session";
			activeSessionId?: string;
			sessions: SessionMenuEvent["sessions"];
	  }
	| {
			kind: "status";
			text: string;
	  };

interface RuntimePopupState {
	popup: BrowserRuntimePopup | null;
	openAgentMenu: (event: AgentMenuEvent) => void;
	openSessionMenu: (event: SessionMenuEvent) => void;
	openStatus: (text: string) => void;
	closePopup: () => void;
}

export const useRuntimePopupStore = create<RuntimePopupState>((set) => ({
	popup: null,
	openAgentMenu: (event) =>
		set({
			popup: {
				kind: "agent",
				activeAgentId: event.activeAgentId,
				activeAgentName: event.activeAgentName,
				agents: event.agents,
			},
		}),
	openSessionMenu: (event) =>
		set({
			popup: {
				kind: "session",
				activeSessionId: event.activeSessionId,
				sessions: event.sessions,
			},
		}),
	openStatus: (text) =>
		set({
			popup: {
				kind: "status",
				text,
			},
		}),
	closePopup: () => set({ popup: null }),
}));
