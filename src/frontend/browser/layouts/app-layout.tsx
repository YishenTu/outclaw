import { useCallback, useEffect, useRef, useState } from "react";
import { useIsMobile } from "../lib/use-is-mobile.ts";
import { useRolloverNoticeAutoDismiss } from "../notices/use-rollover-notice-auto-dismiss.ts";
import { useLayoutStore } from "../stores/layout.ts";
import { useWorkspaceViewStore } from "../stores/workspace-view.ts";
import {
	applyAppLayoutResizeBodyStyles,
	calculateLayoutResizeWidth,
	calculateMaxInspectorWidth,
	resolveInspectorFit,
} from "./app-layout-policy.ts";
import { AppLayoutView, type ResizeSide } from "./app-layout-view.tsx";
import { MobileLayoutView } from "./mobile-layout-view.tsx";

export function AppLayout() {
	useRolloverNoticeAutoDismiss();
	const isMobile = useIsMobile();

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
			calculateMaxInspectorWidth({
				containerWidth,
				leftCollapsed,
				showWelcomePage,
				sidebarWidth,
			}),
		[getContainerWidth, leftCollapsed, showWelcomePage, sidebarWidth],
	);

	const handleMouseMove = useCallback(
		(event: MouseEvent) => {
			if (!resizingSide || !containerRef.current) {
				return;
			}

			const rect = containerRef.current.getBoundingClientRect();
			const width = calculateLayoutResizeWidth({
				clientX: event.clientX,
				containerLeft: rect.left,
				containerRight: rect.right,
				containerWidth: rect.width,
				leftCollapsed,
				showWelcomePage,
				side: resizingSide,
				sidebarWidth,
			});
			if (resizingSide === "left") {
				setSidebarWidth(width);
				return;
			}
			setInspectorWidth(width);
		},
		[
			leftCollapsed,
			resizingSide,
			setInspectorWidth,
			setSidebarWidth,
			showWelcomePage,
			sidebarWidth,
		],
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
		const cleanupBodyStyles = applyAppLayoutResizeBodyStyles(
			document.body.style,
		);

		return () => {
			document.removeEventListener("mousemove", handleMouseMove);
			document.removeEventListener("mouseup", stopResize);
			cleanupBodyStyles();
		};
	}, [handleMouseMove, resizingSide, stopResize]);

	useEffect(() => {
		if (showWelcomePage) {
			return;
		}

		const fitOrCollapseRightPanel = () => {
			const fit = resolveInspectorFit({
				inspectorWidth,
				maxInspectorWidth: getMaxInspectorWidth(getContainerWidth()),
				rightCollapsed,
			});
			if (fit.type === "resize") {
				setInspectorWidth(fit.inspectorWidth);
				return;
			}
			if (fit.type === "collapse") {
				setRightCollapsed(true);
			}
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

	if (isMobile) {
		// `pt/pb-[env(safe-area-inset-*)]` reserves space for the iPhone notch
		// and home indicator when launched as a pinned home-screen app
		// (`apple-mobile-web-app-capable`). On regular Safari the insets are
		// zero, so this is a no-op outside standalone mode.
		return (
			<div
				className="flex h-dvh max-h-dvh overflow-hidden bg-dark-950"
				style={{
					paddingTop: "env(safe-area-inset-top)",
					paddingBottom: "env(safe-area-inset-bottom)",
				}}
			>
				<MobileLayoutView />
			</div>
		);
	}

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
