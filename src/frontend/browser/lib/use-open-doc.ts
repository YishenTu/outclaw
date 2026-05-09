import { useCallback } from "react";
import { useMobileNavStore } from "../stores/mobile-nav.ts";
import { type Tab, useTabsStore } from "../stores/tabs.ts";
import { useIsMobile } from "./use-is-mobile.ts";

/**
 * Single entry point for "open a document-like tab" (file / git-diff /
 * git-commit). On desktop it routes through the multi-tab center store.
 * On mobile it routes through the single-slot overlay so the existing
 * sidebars don't have to know which mode they're in.
 *
 * Chat tabs are never opened through this hook — chat is the home panel.
 */
export function useOpenDoc(): (tab: Exclude<Tab, { type: "chat" }>) => void {
	const isMobile = useIsMobile();
	const openTab = useTabsStore((state) => state.openTab);
	const openOverlay = useMobileNavStore((state) => state.openOverlay);

	return useCallback(
		(tab) => {
			if (isMobile) {
				openOverlay(tab);
				return;
			}
			openTab(tab);
		},
		[isMobile, openTab, openOverlay],
	);
}
