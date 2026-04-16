import { useCallback, useEffect, useRef, useState } from "react";
import { AgentSidebar } from "../components/agent-sidebar/agent-sidebar";
import { CenterPanel } from "../components/center/center-panel";
import { RightPanel } from "../components/right-panel/right-panel";
import {
	MAX_INSPECTOR_WIDTH,
	MAX_SIDEBAR_WIDTH,
	MIN_INSPECTOR_WIDTH,
	MIN_SIDEBAR_WIDTH,
	useLayoutStore,
} from "../stores/layout.ts";

const MIN_CENTER_WIDTH = 560;
const MIN_VISIBLE_INSPECTOR_WIDTH = 400;

type ResizeSide = "left" | "right" | null;

export function AppLayout() {
	const sidebarWidth = useLayoutStore((state) => state.sidebarWidth);
	const inspectorWidth = useLayoutStore((state) => state.inspectorWidth);
	const leftCollapsed = useLayoutStore((state) => state.leftCollapsed);
	const rightCollapsed = useLayoutStore((state) => state.rightCollapsed);
	const setSidebarWidth = useLayoutStore((state) => state.setSidebarWidth);
	const setInspectorWidth = useLayoutStore((state) => state.setInspectorWidth);
	const setLeftCollapsed = useLayoutStore((state) => state.setLeftCollapsed);
	const setRightCollapsed = useLayoutStore((state) => state.setRightCollapsed);
	const [resizingSide, setResizingSide] = useState<ResizeSide>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	const getContainerWidth = useCallback(() => {
		if (!containerRef.current) {
			return window.innerWidth;
		}
		return (
			containerRef.current.getBoundingClientRect().width || window.innerWidth
		);
	}, []);

	const getMaxInspectorWidth = useCallback(
		(containerWidth = getContainerWidth()) =>
			Math.max(
				MIN_INSPECTOR_WIDTH,
				containerWidth - (leftCollapsed ? 0 : sidebarWidth) - MIN_CENTER_WIDTH,
			),
		[getContainerWidth, leftCollapsed, sidebarWidth],
	);

	const handleMouseMove = useCallback(
		(event: MouseEvent) => {
			if (!resizingSide || !containerRef.current) {
				return;
			}

			const rect = containerRef.current.getBoundingClientRect();
			if (resizingSide === "left") {
				const nextWidth = event.clientX - rect.left;
				setSidebarWidth(
					Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, nextWidth)),
				);
				return;
			}

			const nextWidth = rect.right - event.clientX;
			const boundedWidth = Math.min(
				MAX_INSPECTOR_WIDTH,
				Math.max(MIN_INSPECTOR_WIDTH, nextWidth),
			);
			setInspectorWidth(
				Math.min(getMaxInspectorWidth(rect.width), boundedWidth),
			);
		},
		[getMaxInspectorWidth, resizingSide, setInspectorWidth, setSidebarWidth],
	);

	const stopResize = useCallback(() => {
		setResizingSide(null);
	}, []);

	const handleLeftMouseDown = useCallback(
		(event: React.MouseEvent<HTMLButtonElement>) => {
			event.preventDefault();
			setResizingSide("left");
		},
		[],
	);

	const handleRightMouseDown = useCallback(
		(event: React.MouseEvent<HTMLButtonElement>) => {
			event.preventDefault();
			setResizingSide("right");
		},
		[],
	);

	const handleExpandLeft = useCallback(() => {
		setLeftCollapsed(false);
	}, [setLeftCollapsed]);

	const handleExpandRight = useCallback(() => {
		setInspectorWidth(
			Math.min(
				useLayoutStore.getState().inspectorWidth,
				getMaxInspectorWidth(),
			),
		);
		setRightCollapsed(false);
	}, [getMaxInspectorWidth, setInspectorWidth, setRightCollapsed]);

	useEffect(() => {
		if (!resizingSide) {
			return;
		}

		document.addEventListener("mousemove", handleMouseMove);
		document.addEventListener("mouseup", stopResize);
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";

		return () => {
			document.removeEventListener("mousemove", handleMouseMove);
			document.removeEventListener("mouseup", stopResize);
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
		};
	}, [handleMouseMove, resizingSide, stopResize]);

	useEffect(() => {
		const fitOrCollapseRightPanel = () => {
			if (rightCollapsed) {
				return;
			}

			const maxInspectorWidth = getMaxInspectorWidth(getContainerWidth());
			if (inspectorWidth <= maxInspectorWidth) {
				return;
			}

			if (maxInspectorWidth >= MIN_VISIBLE_INSPECTOR_WIDTH) {
				setInspectorWidth(maxInspectorWidth);
				return;
			}

			setRightCollapsed(true);
		};

		fitOrCollapseRightPanel();
		window.addEventListener("resize", fitOrCollapseRightPanel);
		return () => window.removeEventListener("resize", fitOrCollapseRightPanel);
	}, [
		getContainerWidth,
		getMaxInspectorWidth,
		inspectorWidth,
		rightCollapsed,
		setInspectorWidth,
		setRightCollapsed,
	]);

	const leftWidth = leftCollapsed ? 0 : sidebarWidth;
	const rightWidth = rightCollapsed ? 0 : inspectorWidth;

	return (
		<div ref={containerRef} className="flex h-screen bg-dark-950">
			<div
				style={{ width: leftWidth }}
				className={`flex-shrink-0 overflow-hidden border-r border-dark-800 ${
					resizingSide ? "" : "transition-[width] duration-200"
				}`}
			>
				<div style={{ width: sidebarWidth }} className="h-full">
					<AgentSidebar onCollapse={() => setLeftCollapsed(true)} />
				</div>
			</div>
			{!leftCollapsed && (
				<button
					type="button"
					aria-label="Resize left sidebar"
					onMouseDown={handleLeftMouseDown}
					className="relative -ml-1 w-1 flex-shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-dark-600"
				>
					<span className="absolute left-0 right-0 top-12 -mt-px h-px bg-dark-800" />
				</button>
			)}
			<div className="min-w-0 flex-1 overflow-hidden">
				<CenterPanel
					leftCollapsed={leftCollapsed}
					rightCollapsed={rightCollapsed}
					onExpandLeft={handleExpandLeft}
					onExpandRight={handleExpandRight}
				/>
			</div>
			{!rightCollapsed && (
				<button
					type="button"
					aria-label="Resize right sidebar"
					onMouseDown={handleRightMouseDown}
					className="relative w-1 flex-shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-dark-600"
				>
					<span className="absolute left-0 right-0 top-12 -mt-px h-px bg-dark-800" />
					<span className="absolute left-0 right-0 top-20 -mt-px h-px bg-dark-800" />
				</button>
			)}
			<div
				style={{ width: rightWidth }}
				className={`flex-shrink-0 overflow-hidden border-l border-dark-800 ${
					resizingSide ? "" : "transition-[width] duration-200"
				}`}
			>
				<div style={{ width: inspectorWidth }} className="h-full">
					<RightPanel onCollapse={() => setRightCollapsed(true)} />
				</div>
			</div>
		</div>
	);
}
