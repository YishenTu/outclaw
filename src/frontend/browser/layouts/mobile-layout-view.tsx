import { type ReactNode, useCallback, useMemo } from "react";
import { AgentSidebar } from "../components/agent-sidebar/agent-sidebar";
import { CenterPanel } from "../components/center/center-panel.tsx";
import { RightPanel } from "../components/right-panel/right-panel";
import { useEdgeSwipe } from "../lib/use-edge-swipe.ts";
import { useMobileKeyboardScrollReset } from "../lib/use-mobile-keyboard-scroll-reset.ts";
import { type MobilePanel, useMobileNavStore } from "../stores/mobile-nav.ts";
import { MobileOverlay } from "./mobile-overlay.tsx";

/** Panel order, left to right, for swipe navigation. */
const PANEL_ORDER: readonly MobilePanel[] = ["agents", "chat", "inspector"];

function neighbor(current: MobilePanel, direction: -1 | 1): MobilePanel | null {
	const index = PANEL_ORDER.indexOf(current);
	const next = PANEL_ORDER[index + direction];
	return next ?? null;
}

interface MobilePanelShellProps {
	visible: boolean;
	children: ReactNode;
}

/**
 * Wraps a mounted-but-possibly-hidden mobile panel. All three panels stay
 * mounted so scroll position and in-flight state survive navigation.
 */
function MobilePanelShell({ visible, children }: MobilePanelShellProps) {
	return (
		<div
			aria-hidden={!visible}
			className={`absolute inset-0 ${visible ? "block" : "hidden"}`}
		>
			{children}
		</div>
	);
}

export function MobileLayoutView() {
	const mobilePanel = useMobileNavStore((state) => state.mobilePanel);
	const setMobilePanel = useMobileNavStore((state) => state.setMobilePanel);
	const overlayDoc = useMobileNavStore((state) => state.overlayDoc);
	const closeOverlay = useMobileNavStore((state) => state.closeOverlay);
	useMobileKeyboardScrollReset(true);

	const goToChat = useCallback(() => setMobilePanel("chat"), [setMobilePanel]);
	const goToAgents = useCallback(
		() => setMobilePanel("agents"),
		[setMobilePanel],
	);
	const goToInspector = useCallback(
		() => setMobilePanel("inspector"),
		[setMobilePanel],
	);

	// Edge swipes: when an overlay is open, both directions of a left-edge
	// swipe close it (back gesture). Otherwise swipes step through the panel
	// order — left edge → previous, right edge → next.
	const swipeHandlers = useMemo(
		() => ({
			onSwipeRightFromLeftEdge: () => {
				if (overlayDoc) {
					closeOverlay();
					return;
				}
				const target = neighbor(mobilePanel, -1);
				if (target) {
					setMobilePanel(target);
				}
			},
			onSwipeLeftFromRightEdge: () => {
				if (overlayDoc) {
					return;
				}
				const target = neighbor(mobilePanel, 1);
				if (target) {
					setMobilePanel(target);
				}
			},
		}),
		[mobilePanel, overlayDoc, setMobilePanel, closeOverlay],
	);
	useEdgeSwipe(swipeHandlers, true);

	return (
		<div className="relative h-full w-full min-w-0 flex-1 overflow-hidden">
			{/*
			 * Reuse the existing desktop chrome:
			 *  - AgentSidebar's `onCollapse` button → "back to chat".
			 *  - CenterPanel's tab-bar chevrons (shown when *Collapsed=true) →
			 *    navigate to agents/inspector.
			 *  - RightPanel's `onCollapse` button → "back to chat".
			 * No extra mobile header rows are needed.
			 */}
			<MobilePanelShell visible={mobilePanel === "agents"}>
				<AgentSidebar onCollapse={goToChat} />
			</MobilePanelShell>

			<MobilePanelShell visible={mobilePanel === "chat"}>
				<CenterPanel
					leftCollapsed
					rightCollapsed
					onExpandLeft={goToAgents}
					onExpandRight={goToInspector}
				/>
			</MobilePanelShell>

			<MobilePanelShell visible={mobilePanel === "inspector"}>
				<RightPanel onCollapse={goToChat} />
			</MobilePanelShell>

			<MobileOverlay />
		</div>
	);
}
