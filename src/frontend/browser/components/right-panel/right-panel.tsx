import {
	Clock3,
	FolderTree,
	GitBranch,
	PanelRightOpen,
	TerminalSquare,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
	BrowserGitStatusResponse,
	BrowserTreeEntry,
} from "../../../../common/protocol.ts";
import { fetchAgentTree, fetchGitStatus } from "../../lib/api.ts";
import { useAgentsStore } from "../../stores/agents.ts";
import {
	MAX_RIGHT_PANEL_SPLIT_RATIO,
	MIN_RIGHT_PANEL_SPLIT_RATIO,
	useLayoutStore,
} from "../../stores/layout.ts";
import { useTabsStore } from "../../stores/tabs.ts";
import { CronPanel } from "./cron-panel.tsx";
import { FileTree } from "./file-tree.tsx";
import { GitPanel } from "./git-panel.tsx";
import { moveRightPanelTab, type RightPanelTab } from "./right-panel-layout.ts";
import { TerminalPanel } from "./terminal-panel.tsx";

const TAB_LABELS: Record<RightPanelTab, string> = {
	files: "Files",
	cron: "Cron",
	git: "Git",
	terminal: "Terminal",
};

const GHOST_TAB_CLASS =
	"pointer-events-none inline-flex h-6 self-center items-center rounded border border-dashed border-dark-700 bg-dark-900/80 px-3 font-mono-ui text-[11px] uppercase tracking-[0.12em] text-dark-200";
const TAB_DRAG_START_THRESHOLD_PX = 4;

interface PendingTabDrag {
	fromLower: boolean;
	pointerId: number;
	startX: number;
	startY: number;
	tab: RightPanelTab;
}

interface RightPanelProps {
	onCollapse?: () => void;
}

function isPointInRect(x: number, y: number, rect: DOMRect): boolean {
	return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function isPointInBottomHalf(x: number, y: number, rect: DOMRect): boolean {
	return isPointInRect(x, y, rect) && y >= rect.top + rect.height / 2;
}

function getTabIcon(tab: RightPanelTab, size: number) {
	if (tab === "files") {
		return <FolderTree size={size} />;
	}
	if (tab === "cron") {
		return <Clock3 size={size} />;
	}
	if (tab === "git") {
		return <GitBranch size={size} />;
	}
	return <TerminalSquare size={size} />;
}

export function RightPanel({ onCollapse }: RightPanelProps) {
	const activeAgentId = useAgentsStore((state) => state.activeAgentId);
	const openTab = useTabsStore((state) => state.openTab);
	const layout = useLayoutStore((state) => state.rightPanelLayout);
	const setRightPanelLayout = useLayoutStore(
		(state) => state.setRightPanelLayout,
	);
	const splitRatio = useLayoutStore((state) => state.rightPanelSplitRatio);
	const setRightPanelSplitRatio = useLayoutStore(
		(state) => state.setRightPanelSplitRatio,
	);
	const layoutRef = useRef(layout);
	const [tree, setTree] = useState<BrowserTreeEntry[]>([]);
	const [treeLoading, setTreeLoading] = useState(false);
	const [treeError, setTreeError] = useState<string | null>(null);
	const [gitStatus, setGitStatus] = useState<BrowserGitStatusResponse | null>(
		null,
	);
	const [gitLoading, setGitLoading] = useState(false);
	const [gitError, setGitError] = useState<string | null>(null);
	const [isTrackingPointer, setIsTrackingPointer] = useState(false);
	const [isDragging, setIsDragging] = useState(false);
	const [isDraggingFromLower, setIsDraggingFromLower] = useState(false);
	const [isGhostSnapped, setIsGhostSnapped] = useState(false);
	const [dragCursorPosition, setDragCursorPosition] = useState<{
		x: number;
		y: number;
	} | null>(null);
	const [dragOverUpperPane, setDragOverUpperPane] = useState(false);
	const [dragOverLowerPane, setDragOverLowerPane] = useState(false);
	const [isResizing, setIsResizing] = useState(false);
	const contentRef = useRef<HTMLDivElement | null>(null);
	const upperTabBarRef = useRef<HTMLDivElement | null>(null);
	const lowerTabBarRef = useRef<HTMLDivElement | null>(null);
	const splitUpperPaneRef = useRef<HTMLDivElement | null>(null);
	const splitLowerPaneRef = useRef<HTMLDivElement | null>(null);
	const upperTabRefs = useRef<Partial<Record<RightPanelTab, HTMLElement>>>({});
	const lowerTabRefs = useRef<Partial<Record<RightPanelTab, HTMLElement>>>({});
	const activeDragPointerIdRef = useRef<number | null>(null);
	const pendingTabDragRef = useRef<PendingTabDrag | null>(null);
	const draggedTabRef = useRef<RightPanelTab | null>(null);
	const lastDragEndedAtRef = useRef<number | null>(null);

	useEffect(() => {
		layoutRef.current = layout;
	}, [layout]);

	useEffect(() => {
		if (!activeAgentId) {
			setTree([]);
			setTreeError(null);
			return;
		}

		let cancelled = false;
		setTreeLoading(true);
		setTreeError(null);
		void fetchAgentTree(activeAgentId)
			.then((nextTree) => {
				if (!cancelled) {
					setTree(nextTree);
				}
			})
			.catch((error) => {
				if (!cancelled) {
					setTree([]);
					setTreeError(
						error instanceof Error ? error.message : "Failed to load file tree",
					);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setTreeLoading(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [activeAgentId]);

	useEffect(() => {
		let cancelled = false;
		setGitLoading(true);
		setGitError(null);
		void fetchGitStatus()
			.then((nextStatus) => {
				if (!cancelled) {
					setGitStatus(nextStatus);
				}
			})
			.catch((error) => {
				if (!cancelled) {
					setGitStatus(null);
					setGitError(
						error instanceof Error
							? error.message
							: "Failed to load git status",
					);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setGitLoading(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, []);

	const handleOpenFile = (params: { agentId: string; path: string }) => {
		openTab({
			type: "file",
			id: `${params.agentId}:${params.path}`,
			agentId: params.agentId,
			path: params.path,
		});
	};

	const handleOpenDiff = (path: string) => {
		openTab({
			type: "git-diff",
			id: `git-diff:${path}`,
			path,
		});
	};

	const moveTab = useCallback(
		(tab: RightPanelTab, toLower: boolean, targetIndex?: number) => {
			setRightPanelLayout((current) =>
				moveRightPanelTab(current, tab, toLower, targetIndex),
			);
		},
		[setRightPanelLayout],
	);

	const clearDragState = useCallback(() => {
		activeDragPointerIdRef.current = null;
		pendingTabDragRef.current = null;
		draggedTabRef.current = null;
		setIsTrackingPointer(false);
		setIsDragging(false);
		setIsDraggingFromLower(false);
		setIsGhostSnapped(false);
		setDragCursorPosition(null);
		setDragOverUpperPane(false);
		setDragOverLowerPane(false);
	}, []);

	const beginTabDrag = useCallback(
		(tab: RightPanelTab, fromLower: boolean, x: number, y: number) => {
			draggedTabRef.current = tab;
			setIsDragging(true);
			setIsDraggingFromLower(fromLower);
			setDragCursorPosition({ x, y });
			setIsGhostSnapped(false);
		},
		[],
	);

	const handleTabClick = useCallback(
		(tab: RightPanelTab, isLower: boolean) => {
			if (
				lastDragEndedAtRef.current !== null &&
				performance.now() - lastDragEndedAtRef.current < 150
			) {
				return;
			}

			setRightPanelLayout((current) =>
				isLower
					? { ...current, activeLowerTab: tab }
					: { ...current, activeUpperTab: tab },
			);
		},
		[setRightPanelLayout],
	);

	const handleTabPointerDown = useCallback(
		(
			event: React.PointerEvent<HTMLButtonElement>,
			tab: RightPanelTab,
			fromLower: boolean,
		) => {
			if (event.button !== 0 || activeDragPointerIdRef.current !== null) {
				return;
			}

			activeDragPointerIdRef.current = event.pointerId;
			pendingTabDragRef.current = {
				fromLower,
				pointerId: event.pointerId,
				startX: event.clientX,
				startY: event.clientY,
				tab,
			};
			setIsTrackingPointer(true);
		},
		[],
	);

	const getInsertIndexFromPointer = useCallback(
		(tabs: RightPanelTab[], isLower: boolean, clientX: number) => {
			const refs = isLower ? lowerTabRefs.current : upperTabRefs.current;
			for (let index = 0; index < tabs.length; index += 1) {
				const tab = tabs[index];
				const element = tab ? refs[tab] : null;
				if (!element) {
					continue;
				}
				const rect = element.getBoundingClientRect();
				const midpoint = rect.left + rect.width / 2;
				if (clientX < midpoint) {
					return index;
				}
			}
			return tabs.length;
		},
		[],
	);

	const handlePointerMoveWhileDragging = useCallback(
		(event: PointerEvent) => {
			if (activeDragPointerIdRef.current !== event.pointerId) {
				return;
			}

			const pending = pendingTabDragRef.current;
			if (pending && !draggedTabRef.current) {
				const dx = event.clientX - pending.startX;
				const dy = event.clientY - pending.startY;
				if (Math.hypot(dx, dy) < TAB_DRAG_START_THRESHOLD_PX) {
					return;
				}
				beginTabDrag(
					pending.tab,
					pending.fromLower,
					event.clientX,
					event.clientY,
				);
				pendingTabDragRef.current = null;
			}

			const draggedTab = draggedTabRef.current;
			if (!draggedTab) {
				return;
			}

			const currentLayout = layoutRef.current;
			setDragCursorPosition({ x: event.clientX, y: event.clientY });

			const upperBarRect = upperTabBarRef.current?.getBoundingClientRect();
			if (
				upperBarRect &&
				isPointInRect(event.clientX, event.clientY, upperBarRect)
			) {
				setIsGhostSnapped(true);
				moveTab(
					draggedTab,
					false,
					getInsertIndexFromPointer(
						currentLayout.upperTabs,
						false,
						event.clientX,
					),
				);
				setDragOverUpperPane(false);
				setDragOverLowerPane(false);
				return;
			}

			const lowerBarRect = lowerTabBarRef.current?.getBoundingClientRect();
			if (
				lowerBarRect &&
				isPointInRect(event.clientX, event.clientY, lowerBarRect)
			) {
				setIsGhostSnapped(true);
				moveTab(
					draggedTab,
					true,
					getInsertIndexFromPointer(
						currentLayout.lowerTabs,
						true,
						event.clientX,
					),
				);
				setDragOverUpperPane(false);
				setDragOverLowerPane(false);
				return;
			}

			setIsGhostSnapped(false);

			if (currentLayout.lowerTabs.length > 0) {
				const upperPaneRect =
					splitUpperPaneRef.current?.getBoundingClientRect() ?? null;
				if (
					upperPaneRect &&
					isPointInRect(event.clientX, event.clientY, upperPaneRect)
				) {
					if (currentLayout.lowerTabs.includes(draggedTab)) {
						moveTab(draggedTab, false);
					}
					setDragOverUpperPane(true);
					setDragOverLowerPane(false);
					return;
				}

				const lowerPaneRect =
					splitLowerPaneRef.current?.getBoundingClientRect() ?? null;
				if (
					lowerPaneRect &&
					isPointInRect(event.clientX, event.clientY, lowerPaneRect)
				) {
					if (currentLayout.upperTabs.includes(draggedTab)) {
						moveTab(draggedTab, true);
					}
					setDragOverUpperPane(false);
					setDragOverLowerPane(true);
					return;
				}

				setDragOverUpperPane(false);
				setDragOverLowerPane(false);
				return;
			}

			const contentRect = contentRef.current?.getBoundingClientRect() ?? null;
			setDragOverUpperPane(false);
			setDragOverLowerPane(
				contentRect
					? isPointInBottomHalf(event.clientX, event.clientY, contentRect)
					: false,
			);
		},
		[beginTabDrag, getInsertIndexFromPointer, moveTab],
	);

	const handlePointerUpWhileDragging = useCallback(
		(event: PointerEvent) => {
			if (activeDragPointerIdRef.current !== event.pointerId) {
				return;
			}

			if (pendingTabDragRef.current) {
				clearDragState();
				return;
			}

			const draggedTab = draggedTabRef.current;
			if (!draggedTab) {
				clearDragState();
				return;
			}

			const currentLayout = layoutRef.current;
			if (currentLayout.lowerTabs.length === 0) {
				const contentRect = contentRef.current?.getBoundingClientRect() ?? null;
				if (
					contentRect &&
					isPointInBottomHalf(event.clientX, event.clientY, contentRect)
				) {
					moveTab(draggedTab, true);
				}
			}

			lastDragEndedAtRef.current = performance.now();
			clearDragState();
		},
		[clearDragState, moveTab],
	);

	useEffect(() => {
		if (!isTrackingPointer) {
			return;
		}

		window.addEventListener("pointermove", handlePointerMoveWhileDragging);
		window.addEventListener("pointerup", handlePointerUpWhileDragging);
		window.addEventListener("pointercancel", handlePointerUpWhileDragging);
		window.addEventListener("blur", clearDragState);

		return () => {
			window.removeEventListener("pointermove", handlePointerMoveWhileDragging);
			window.removeEventListener("pointerup", handlePointerUpWhileDragging);
			window.removeEventListener("pointercancel", handlePointerUpWhileDragging);
			window.removeEventListener("blur", clearDragState);
		};
	}, [
		clearDragState,
		handlePointerMoveWhileDragging,
		handlePointerUpWhileDragging,
		isTrackingPointer,
	]);

	useEffect(() => {
		if (!isDragging) {
			document.body.style.userSelect = "";
			return;
		}

		document.body.style.userSelect = "none";
		document.body.style.cursor = "grabbing";
		return () => {
			document.body.style.userSelect = "";
			document.body.style.cursor = "";
		};
	}, [isDragging]);

	const handleResizeMouseDown = useCallback(
		(event: React.MouseEvent<HTMLButtonElement>) => {
			event.preventDefault();
			setIsResizing(true);
		},
		[],
	);

	const handleResizeMove = useCallback(
		(event: MouseEvent) => {
			const content = contentRef.current;
			if (!content) {
				return;
			}

			const rect = content.getBoundingClientRect();
			const nextRatio = (event.clientY - rect.top) / rect.height;
			setRightPanelSplitRatio(
				Math.max(
					MIN_RIGHT_PANEL_SPLIT_RATIO,
					Math.min(MAX_RIGHT_PANEL_SPLIT_RATIO, nextRatio),
				),
			);
		},
		[setRightPanelSplitRatio],
	);

	const handleResizeUp = useCallback(() => {
		setIsResizing(false);
	}, []);

	useEffect(() => {
		if (!isResizing) {
			return;
		}

		document.addEventListener("mousemove", handleResizeMove);
		document.addEventListener("mouseup", handleResizeUp);
		document.body.style.userSelect = "none";
		document.body.style.cursor = "row-resize";

		return () => {
			document.removeEventListener("mousemove", handleResizeMove);
			document.removeEventListener("mouseup", handleResizeUp);
			document.body.style.userSelect = "";
			document.body.style.cursor = "";
		};
	}, [handleResizeMove, handleResizeUp, isResizing]);

	function tabRefCallback(tab: RightPanelTab, isLower: boolean) {
		return (element: HTMLElement | null) => {
			const refs = isLower ? lowerTabRefs.current : upperTabRefs.current;
			if (element) {
				refs[tab] = element;
				return;
			}
			delete refs[tab];
		};
	}

	function renderPaneContent(tab: RightPanelTab, isVisible: boolean) {
		if (tab === "files") {
			return (
				<div className="scrollbar-none h-full overflow-y-auto">
					{treeLoading ? (
						<div className="px-4 py-4 text-sm text-dark-500">
							Loading files…
						</div>
					) : treeError ? (
						<div className="px-4 py-4 text-sm text-red-300">{treeError}</div>
					) : activeAgentId ? (
						<FileTree
							agentId={activeAgentId}
							entries={tree}
							onOpenFile={handleOpenFile}
						/>
					) : (
						<div className="px-4 py-4 text-sm text-dark-500">
							No active agent.
						</div>
					)}
				</div>
			);
		}

		if (tab === "cron") {
			return (
				<div className="scrollbar-none h-full overflow-y-auto">
					{activeAgentId ? (
						<CronPanel
							agentId={activeAgentId}
							treeEntries={tree}
							onOpenFile={handleOpenFile}
						/>
					) : (
						<div className="px-4 py-4 text-sm text-dark-500">
							No active agent.
						</div>
					)}
				</div>
			);
		}

		if (tab === "git") {
			return (
				<GitPanel
					status={gitStatus}
					loading={gitLoading}
					error={gitError}
					onOpenDiff={handleOpenDiff}
				/>
			);
		}

		return <TerminalPanel agentId={activeAgentId} active={isVisible} />;
	}

	function renderTabBar(
		tabs: RightPanelTab[],
		activeTab: RightPanelTab,
		isLower: boolean,
	) {
		return tabs.map((tab) => {
			const isDraggedTab = isDragging && draggedTabRef.current === tab;

			if (isDraggedTab) {
				if (!isGhostSnapped) {
					return null;
				}
				return (
					<div
						key={tab}
						ref={tabRefCallback(tab, isLower)}
						className={GHOST_TAB_CLASS}
						aria-hidden="true"
					>
						{TAB_LABELS[tab]}
					</div>
				);
			}

			return (
				<button
					key={tab}
					type="button"
					draggable={false}
					ref={tabRefCallback(tab, isLower)}
					onClick={() => handleTabClick(tab, isLower)}
					onPointerDown={(event) => handleTabPointerDown(event, tab, isLower)}
					className={`relative flex select-none items-center gap-1.5 pl-2 pr-3 font-mono-ui text-[11px] uppercase tracking-[0.12em] transition-colors ${
						isDragging
							? "cursor-grabbing"
							: "cursor-grab active:cursor-grabbing"
					} ${
						activeTab === tab
							? "text-dark-100"
							: "text-dark-500 hover:text-dark-200"
					}`}
				>
					{activeTab === tab && (
						<span className="absolute bottom-0 left-0 right-0 -mb-px h-0.5 bg-dark-100" />
					)}
					{getTabIcon(tab, 14)}
					{TAB_LABELS[tab]}
				</button>
			);
		});
	}

	function renderPaneTabs(tabs: RightPanelTab[], activeTab: RightPanelTab) {
		return tabs.map((tab) => (
			<div
				key={tab}
				className={
					activeTab === tab
						? "h-full flex flex-col min-h-0 min-w-0 overflow-hidden"
						: "hidden"
				}
			>
				{renderPaneContent(tab, activeTab === tab)}
			</div>
		));
	}

	const isSplit = layout.lowerTabs.length > 0;
	const upperHeight = `${splitRatio * 100}%`;
	const lowerHeight = `${(1 - splitRatio) * 100}%`;

	return (
		<div className="flex h-full flex-col bg-dark-950">
			<div className="flex h-12 items-stretch gap-2 border-b border-dark-800 px-3">
				{onCollapse && (
					<button
						type="button"
						onClick={onCollapse}
						className="flex items-center justify-center text-dark-500 transition-colors hover:text-dark-100"
						aria-label="Collapse right sidebar"
					>
						<PanelRightOpen size={15} />
					</button>
				)}
				<div
					ref={upperTabBarRef}
					className="flex min-w-0 flex-1 items-stretch gap-2"
				>
					{renderTabBar(layout.upperTabs, layout.activeUpperTab, false)}
				</div>
			</div>

			<div
				ref={contentRef}
				className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
			>
				{isSplit ? (
					<>
						<div
							ref={splitUpperPaneRef}
							style={{ height: upperHeight }}
							className={`min-h-0 overflow-hidden ${isResizing ? "" : "transition-[height] duration-200"} ${
								dragOverUpperPane && isDraggingFromLower ? "bg-dark-900" : ""
							}`}
						>
							<div className="h-full min-h-0 overflow-hidden">
								{renderPaneTabs(layout.upperTabs, layout.activeUpperTab)}
							</div>
						</div>

						<button
							type="button"
							aria-label="Resize right panel split"
							onMouseDown={handleResizeMouseDown}
							className="relative h-1 shrink-0 cursor-row-resize transition-colors hover:bg-dark-600"
						>
							<div className="absolute inset-x-0 top-0 h-px bg-dark-800" />
						</button>

						<div
							ref={splitLowerPaneRef}
							style={{ height: lowerHeight }}
							className={`flex min-h-0 flex-col overflow-hidden ${isResizing ? "" : "transition-[height] duration-200"} ${
								dragOverLowerPane && !isDraggingFromLower ? "bg-dark-900" : ""
							}`}
						>
							<div
								ref={lowerTabBarRef}
								className="flex h-8 items-stretch gap-2 border-b border-dark-800 px-3"
							>
								{renderTabBar(layout.lowerTabs, layout.activeLowerTab, true)}
							</div>
							<div className="min-h-0 flex-1 overflow-hidden">
								{renderPaneTabs(layout.lowerTabs, layout.activeLowerTab)}
							</div>
						</div>
					</>
				) : (
					<>
						<div className="min-h-0 flex-1 overflow-hidden">
							{renderPaneTabs(layout.upperTabs, layout.activeUpperTab)}
						</div>
						{isDragging && (
							<div
								className={`absolute inset-x-0 bottom-0 flex h-1/2 items-center justify-center border-2 border-dashed transition-colors ${
									dragOverLowerPane
										? "border-dark-300 bg-dark-800/40"
										: "border-dark-700 bg-dark-900/25"
								}`}
							>
								<span className="font-mono-ui text-[11px] uppercase tracking-[0.16em] text-dark-300">
									Drop here to split
								</span>
							</div>
						)}
					</>
				)}
			</div>

			{isDragging &&
				dragCursorPosition &&
				draggedTabRef.current &&
				!isGhostSnapped && (
					<div
						className={`fixed z-[999] ${GHOST_TAB_CLASS}`}
						style={{
							left: dragCursorPosition.x + 10,
							top: dragCursorPosition.y + 10,
						}}
					>
						{TAB_LABELS[draggedTabRef.current]}
					</div>
				)}
		</div>
	);
}
