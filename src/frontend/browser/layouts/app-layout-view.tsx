import type { MouseEvent as ReactMouseEvent } from "react";
import { AgentSidebar } from "../components/agent-sidebar/agent-sidebar";
import { CenterPanel } from "../components/center/center-panel";
import { RightPanel } from "../components/right-panel/right-panel";
import { WelcomePage } from "../components/welcome-page";

export type ResizeSide = "left" | "right" | null;

interface AppLayoutViewProps {
	inspectorWidth: number;
	leftCollapsed: boolean;
	onCollapseLeft: (() => void) | undefined;
	onCollapseRight: (() => void) | undefined;
	onExpandLeft: () => void;
	onExpandRight: () => void;
	onLeftResizeMouseDown: (event: ReactMouseEvent<HTMLButtonElement>) => void;
	onRightResizeMouseDown: (event: ReactMouseEvent<HTMLButtonElement>) => void;
	resizingSide: ResizeSide;
	rightCollapsed: boolean;
	showWelcomePage: boolean;
	sidebarWidth: number;
}

export function AppLayoutView({
	inspectorWidth,
	leftCollapsed,
	onCollapseLeft,
	onCollapseRight,
	onExpandLeft,
	onExpandRight,
	onLeftResizeMouseDown,
	onRightResizeMouseDown,
	resizingSide,
	rightCollapsed,
	showWelcomePage,
	sidebarWidth,
}: AppLayoutViewProps) {
	const showLeftSidebar = showWelcomePage || !leftCollapsed;
	const showRightPanel = !showWelcomePage && !rightCollapsed;
	const leftWidth = showLeftSidebar ? sidebarWidth : 0;
	const rightWidth = showRightPanel ? inspectorWidth : 0;

	return (
		<>
			<div
				style={{ width: leftWidth }}
				className={`flex-shrink-0 overflow-hidden border-r border-dark-800 ${
					resizingSide ? "" : "transition-[width] duration-200"
				}`}
			>
				<div style={{ width: sidebarWidth }} className="h-full">
					<AgentSidebar onCollapse={onCollapseLeft} />
				</div>
			</div>
			{showLeftSidebar && (
				<button
					type="button"
					aria-label="Resize left sidebar"
					onMouseDown={onLeftResizeMouseDown}
					className="relative -ml-1 w-1 flex-shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-dark-600"
				>
					<span className="absolute left-0 right-0 top-12 -mt-px h-px bg-dark-800" />
				</button>
			)}
			<div className="min-w-0 flex-1 overflow-hidden">
				{showWelcomePage ? (
					<WelcomePage />
				) : (
					<CenterPanel
						leftCollapsed={leftCollapsed}
						rightCollapsed={rightCollapsed}
						onExpandLeft={onExpandLeft}
						onExpandRight={onExpandRight}
					/>
				)}
			</div>
			{showRightPanel && (
				<button
					type="button"
					aria-label="Resize right sidebar"
					onMouseDown={onRightResizeMouseDown}
					className="relative w-1 flex-shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-dark-600"
				>
					<span className="absolute left-0 right-0 top-12 -mt-px h-px bg-dark-800" />
					<span className="absolute left-0 right-0 top-20 -mt-px h-px bg-dark-800" />
				</button>
			)}
			{showRightPanel && (
				<div
					style={{ width: rightWidth }}
					className={`flex-shrink-0 overflow-hidden border-l border-dark-800 ${
						resizingSide ? "" : "transition-[width] duration-200"
					}`}
				>
					<div style={{ width: inspectorWidth }} className="h-full">
						<RightPanel onCollapse={onCollapseRight} />
					</div>
				</div>
			)}
		</>
	);
}
