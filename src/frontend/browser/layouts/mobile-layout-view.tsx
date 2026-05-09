import { type ReactNode, useCallback, useMemo, useRef } from "react";
import { AgentSidebar } from "../components/agent-sidebar/agent-sidebar";
import { CenterPanel } from "../components/center/center-panel.tsx";
import { RightPanel } from "../components/right-panel/right-panel";
import { type EdgeSwipeHandlers, useEdgeSwipe } from "../lib/use-edge-swipe.ts";
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

interface SwipeStartContext {
	overlayOpen: boolean;
	panel: MobilePanel;
}

type EdgeSwipeHandlersForLayout = EdgeSwipeHandlers<SwipeStartContext>;

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

	// Edge swipes: when an overlay is open, a left-edge right-swipe closes it
	// (back gesture). Otherwise swipes step through the panel order — left
	// edge → previous, right edge → next.
	//
	// We snapshot {overlayOpen, panel} at touchstart rather than read live
	// state at touchend. iOS Safari's own native left-edge back-swipe fires
	// `popstate` mid-gesture, which our `MobileOverlay` listens to and uses
	// to close the overlay. Without a touchstart snapshot, our touchend
	// handler would see `overlayDoc === null` (already closed by iOS) and
	// fall through to "step left in panel order", silently sending the user
	// from Inspector to Chat instead of just closing the overlay.
	const stateRef = useRef<SwipeStartContext>({
		overlayOpen: !!overlayDoc,
		panel: mobilePanel,
	});
	stateRef.current = { overlayOpen: !!overlayDoc, panel: mobilePanel };

	const swipeHandlers = useMemo<EdgeSwipeHandlersForLayout>(
		() => ({
			getStartContext: () => stateRef.current,
			onSwipeRightFromLeftEdge: (ctx) => {
				if (ctx.overlayOpen) {
					closeOverlay();
					return;
				}
				const target = neighbor(ctx.panel, -1);
				if (target) {
					setMobilePanel(target);
				}
			},
			onSwipeLeftFromRightEdge: (ctx) => {
				if (ctx.overlayOpen) {
					return;
				}
				const target = neighbor(ctx.panel, 1);
				if (target) {
					setMobilePanel(target);
				}
			},
		}),
		[setMobilePanel, closeOverlay],
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
