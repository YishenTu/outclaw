import { useCallback, useEffect, useRef, useState } from "react";
import {
	MAX_INSPECTOR_WIDTH,
	MAX_SIDEBAR_WIDTH,
	MIN_INSPECTOR_WIDTH,
	MIN_SIDEBAR_WIDTH,
	useLayoutStore,
} from "../stores/layout.ts";
import { useWorkspaceViewStore } from "../stores/workspace-view.ts";
import { AppLayoutView, type ResizeSide } from "./app-layout-view.tsx";

const MIN_CENTER_WIDTH = 560;
const MIN_VISIBLE_INSPECTOR_WIDTH = 400;

export function AppLayout() {
	const sidebarWidth = useLayoutStore((state) => state.sidebarWidth);
	const inspectorWidth = useLayoutStore((state) => state.inspectorWidth);
	const leftCollapsed = useLayoutStore((state) => state.leftCollapsed);
	const rightCollapsed = useLayoutStore((state) => state.rightCollapsed);
	const showWelcomePage = useWorkspaceViewStore(
		(state) => state.showWelcomePage,
	);
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
				containerWidth -
					(showWelcomePage || !leftCollapsed ? sidebarWidth : 0) -
					MIN_CENTER_WIDTH,
			),
		[getContainerWidth, leftCollapsed, showWelcomePage, sidebarWidth],
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
		if (showWelcomePage) {
			return;
		}

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
		showWelcomePage,
	]);

	return (
		<div ref={containerRef} className="flex h-screen bg-dark-950">
			<AppLayoutView
				inspectorWidth={inspectorWidth}
				leftCollapsed={leftCollapsed}
				onCollapseLeft={
					showWelcomePage ? undefined : () => setLeftCollapsed(true)
				}
				onCollapseRight={() => setRightCollapsed(true)}
				onExpandLeft={handleExpandLeft}
				onExpandRight={handleExpandRight}
				onLeftResizeMouseDown={handleLeftMouseDown}
				onRightResizeMouseDown={handleRightMouseDown}
				resizingSide={resizingSide}
				rightCollapsed={rightCollapsed}
				showWelcomePage={showWelcomePage}
				sidebarWidth={sidebarWidth}
			/>
		</div>
	);
}
