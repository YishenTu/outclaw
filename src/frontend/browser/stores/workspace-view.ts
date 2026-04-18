import { create } from "zustand";

interface WorkspaceViewState {
	showWelcomePage: boolean;
	openWorkspace: () => void;
	resetToWelcome: () => void;
}

export const useWorkspaceViewStore = create<WorkspaceViewState>((set) => ({
	showWelcomePage: true,
	openWorkspace: () => set({ showWelcomePage: false }),
	resetToWelcome: () => set({ showWelcomePage: true }),
}));
