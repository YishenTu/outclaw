import { lazy, type ReactNode, Suspense, useCallback } from "react";
import { AgentSidebar } from "../components/agent-sidebar/agent-sidebar";
import { CenterPanel } from "../components/center/center-panel.tsx";
import { RightPanel } from "../components/right-panel/right-panel";
import { FeatureLoading } from "../components/ui/feature-loading.tsx";
import { useMobileKeyboardScrollReset } from "../lib/use-mobile-keyboard-scroll-reset.ts";
import { useAppModeStore } from "../stores/app-mode.ts";
import { type MobilePanel, useMobileNavStore } from "../stores/mobile-nav.ts";
import { MobileOverlay } from "./mobile-overlay.tsx";

const CodingWorkspaceBootstrap = lazy(async () => {
	const module = await import("../coding/coding-workspace.tsx");
	return { default: module.CodingWorkspaceBootstrap };
});
const CodingCenter = lazy(async () => {
	const module = await import("../coding/coding-workspace.tsx");
	return { default: module.CodingCenter };
});
const CodingRightPanel = lazy(async () => {
	const module = await import("../coding/coding-workspace.tsx");
	return { default: module.CodingRightPanel };
});
const CodingSidebarContainer = lazy(async () => {
	const module = await import("../coding/coding-workspace.tsx");
	return { default: module.CodingSidebarContainer };
});

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
	const appMode = useAppModeStore((state) => state.appMode);
	const isCodeMode = appMode === "code";
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
			{isCodeMode ? (
				<Suspense fallback={null}>
					<CodingWorkspaceBootstrap />
				</Suspense>
			) : null}
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
					<Suspense fallback={<FeatureLoading label="coding sidebar" />}>
						<CodingSidebarContainer
							onCollapse={onShowCenter}
							onActivateCenterPanel={onShowCenter}
						/>
					</Suspense>
				) : (
					<AgentSidebar onCollapse={onShowCenter} />
				)}
			</MobilePanelShell>

			<MobilePanelShell visible={mobilePanel === "chat"}>
				{isCodeMode ? (
					<Suspense fallback={<FeatureLoading label="coding workspace" />}>
						<CodingCenter
							leftCollapsed
							rightCollapsed
							onExpandLeft={onShowLeftPanel}
							onExpandRight={onShowRightPanel}
						/>
					</Suspense>
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
					<Suspense fallback={<FeatureLoading label="coding inspector" />}>
						<CodingRightPanel onCollapse={onShowCenter} />
					</Suspense>
				) : (
					<RightPanel onCollapse={onShowCenter} />
				)}
			</MobilePanelShell>

			<MobileOverlay />
		</div>
	);
}
