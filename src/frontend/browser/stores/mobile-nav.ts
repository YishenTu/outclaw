import { create } from "zustand";
import type { Tab } from "./tabs.ts";

export type MobilePanel = "agents" | "chat" | "inspector";

/**
 * The kinds of tabs that can be promoted to a mobile overlay.
 * Chat is excluded — chat is the home panel, never an overlay.
 */
export type MobileOverlayDoc = Exclude<Tab, { type: "chat" }>;

export interface MobileNavState {
	mobilePanel: MobilePanel;
	overlayDoc: MobileOverlayDoc | null;

	setMobilePanel: (panel: MobilePanel) => void;
	openOverlay: (doc: MobileOverlayDoc) => void;
	closeOverlay: () => void;
}

export const useMobileNavStore = create<MobileNavState>((set) => ({
	mobilePanel: "chat",
	overlayDoc: null,
	setMobilePanel: (panel) => set({ mobilePanel: panel }),
	openOverlay: (doc) => set({ overlayDoc: doc }),
	closeOverlay: () => set({ overlayDoc: null }),
}));
