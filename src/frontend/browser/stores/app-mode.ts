import { create } from "zustand";
import {
	createJSONStorage,
	persist,
	type StateStorage,
} from "zustand/middleware";

export type BrowserAppMode = "chat" | "code";

export const APP_MODE_STORAGE_KEY = "outclaw.browser.app-mode";
const LEGACY_CODING_STORAGE_KEY = "outclaw.browser.coding";

interface AppModeState {
	appMode: BrowserAppMode;
	setAppMode: (mode: BrowserAppMode) => void;
}

const fallbackStorage: StateStorage = {
	getItem: () => null,
	setItem: () => {},
	removeItem: () => {},
};

function safeStorage(): StateStorage {
	return typeof window === "undefined" ? fallbackStorage : window.localStorage;
}

function readLegacyAppMode(): BrowserAppMode {
	if (typeof window === "undefined") {
		return "chat";
	}
	try {
		const raw = window.localStorage.getItem(LEGACY_CODING_STORAGE_KEY);
		if (!raw) {
			return "chat";
		}
		const parsed = JSON.parse(raw) as { state?: { appMode?: unknown } };
		return parsed.state?.appMode === "code" ? "code" : "chat";
	} catch {
		return "chat";
	}
}

export const useAppModeStore = create<AppModeState>()(
	persist(
		(set) => ({
			appMode: readLegacyAppMode(),
			setAppMode: (appMode) => set({ appMode }),
		}),
		{
			name: APP_MODE_STORAGE_KEY,
			storage: createJSONStorage(safeStorage),
			partialize: (state) => ({ appMode: state.appMode }),
		},
	),
);
