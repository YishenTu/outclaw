import { type ReactNode, useCallback } from "react";
import { CodingCenter } from "../coding/coding-center.tsx";
import { useCodingDataLoader } from "../coding/coding-data.ts";
import { CodingRightPanel } from "../coding/coding-right-panel.tsx";
import { CodingSidebarContainer } from "../coding/coding-sidebar-container.tsx";
import { useCodingStore } from "../coding/coding-store.ts";
import { AgentSidebar } from "../components/agent-sidebar/agent-sidebar";
import { CenterPanel } from "../components/center/center-panel.tsx";
import { RightPanel } from "../components/right-panel/right-panel";
import { useMobileKeyboardScrollReset } from "../lib/use-mobile-keyboard-scroll-reset.ts";
import { type MobilePanel, useMobileNavStore } from "../stores/mobile-nav.ts";
import { MobileOverlay } from "./mobile-overlay.tsx";

interface MobilePanelShellProps {
	visible: boolean;
	children: ReactNode;
}

interface MobileLayoutPanelsProps {
	isCodeMode: boolean;
	mobilePanel: MobilePanel;
	onShowCenter: () => void;
	onShowLeftPanel: () => void;
	onShowRightPanel: () => void;
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
	const appMode = useCodingStore((state) => state.appMode);
	const isCodeMode = appMode === "code";
	useCodingDataLoader(isCodeMode);
	useMobileKeyboardScrollReset(true);

	const goToCenter = useCallback(
		() => setMobilePanel("chat"),
		[setMobilePanel],
	);
	const goToLeftPanel = useCallback(
		() => setMobilePanel("agents"),
		[setMobilePanel],
	);
	const goToRightPanel = useCallback(
		() => setMobilePanel("inspector"),
		[setMobilePanel],
	);

	return (
		<MobileLayoutPanels
			isCodeMode={isCodeMode}
			mobilePanel={mobilePanel}
			onShowCenter={goToCenter}
			onShowLeftPanel={goToLeftPanel}
			onShowRightPanel={goToRightPanel}
		/>
	);
}

export function MobileLayoutPanels({
	isCodeMode,
	mobilePanel,
	onShowCenter,
	onShowLeftPanel,
	onShowRightPanel,
}: MobileLayoutPanelsProps) {
	return (
		<div className="relative h-full w-full min-w-0 flex-1 overflow-hidden">
			{/*
			 * Reuse the existing desktop chrome:
			 *  - Sidebar `onCollapse` button -> back to the center panel.
			 *  - Center tab-bar chevrons (shown when *Collapsed=true) navigate to
			 *    the left/right mobile panels.
			 *  - Right panel `onCollapse` button -> back to the center panel.
			 * No extra mobile header rows are needed.
			 */}
			<MobilePanelShell visible={mobilePanel === "agents"}>
				{isCodeMode ? (
					<CodingSidebarContainer
						onCollapse={onShowCenter}
						onActivateCenterPanel={onShowCenter}
					/>
				) : (
					<AgentSidebar onCollapse={onShowCenter} />
				)}
			</MobilePanelShell>

			<MobilePanelShell visible={mobilePanel === "chat"}>
				{isCodeMode ? (
					<CodingCenter
						leftCollapsed
						rightCollapsed
						onExpandLeft={onShowLeftPanel}
						onExpandRight={onShowRightPanel}
					/>
				) : (
					<CenterPanel
						leftCollapsed
						rightCollapsed
						onExpandLeft={onShowLeftPanel}
						onExpandRight={onShowRightPanel}
					/>
				)}
			</MobilePanelShell>

			<MobilePanelShell visible={mobilePanel === "inspector"}>
				{isCodeMode ? (
					<CodingRightPanel onCollapse={onShowCenter} />
				) : (
					<RightPanel onCollapse={onShowCenter} />
				)}
			</MobilePanelShell>

			<MobileOverlay />
		</div>
	);
}
