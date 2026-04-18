import {
	ChevronDown,
	ChevronUp,
	Clock3,
	FolderTree,
	GitBranch,
	PanelRightOpen,
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
import {
	selectAgentTreeRevision,
	selectGitRevision,
	useRightPanelRefreshStore,
} from "../../stores/right-panel-refresh.ts";
import { useTabsStore } from "../../stores/tabs.ts";
import {
	selectActiveTerminalId,
	selectAgentTerminals,
	useTerminalStore,
} from "../../stores/terminal.ts";
import { ActiveTabUnderline } from "../active-tab-underline.tsx";
import { CronPanel } from "./cron-panel.tsx";
import { FileTree, FileTreeHeader } from "./file-tree.tsx";
import { GitPanel } from "./git-panel.tsx";
import {
	shouldFetchAgentTree,
	shouldFetchGitStatus,
} from "./right-panel-fetch-policy.ts";
import {
	UPPER_RIGHT_PANEL_TABS,
	type UpperRightPanelTab,
} from "./right-panel-layout.ts";
import { TerminalPanel } from "./terminal-panel.tsx";
import { TerminalTabs } from "./terminal-tabs.tsx";

const TAB_LABELS: Record<UpperRightPanelTab, string> = {
	files: "Files",
	cron: "Cron",
	git: "Git",
};

interface RightPanelProps {
	onCollapse?: () => void;
}

function getTabIcon(tab: UpperRightPanelTab, size: number) {
	if (tab === "files") {
		return <FolderTree size={size} />;
	}
	if (tab === "cron") {
		return <Clock3 size={size} />;
	}
	return <GitBranch size={size} />;
}

export function RightPanelUpperTabs({
	activeTab,
	onCollapse,
	onSelectTab,
}: {
	activeTab: UpperRightPanelTab;
	onCollapse?: () => void;
	onSelectTab: (tab: UpperRightPanelTab) => void;
}) {
	return (
		<div className="flex h-12 items-stretch gap-2 border-b border-dark-800 px-3">
			{onCollapse ? (
				<button
					type="button"
					onClick={onCollapse}
					className="flex items-center justify-center text-dark-500 transition-colors hover:text-dark-100"
					aria-label="Collapse right sidebar"
				>
					<PanelRightOpen size={15} />
				</button>
			) : null}
			<div className="flex min-w-0 flex-1 items-stretch gap-2">
				{UPPER_RIGHT_PANEL_TABS.map((tab) => (
					<div
						key={tab}
						className={`font-mono-ui relative flex shrink-0 items-center pt-px text-[11px] uppercase tracking-[0.12em] transition-colors ${
							activeTab === tab
								? "text-dark-50"
								: "text-dark-500 hover:text-dark-200"
						}`}
					>
						{activeTab === tab ? <ActiveTabUnderline /> : null}
						<button
							type="button"
							onClick={() => onSelectTab(tab)}
							className="flex h-full items-center gap-1.5 pl-2 pr-3"
						>
							{getTabIcon(tab, 14)}
							{TAB_LABELS[tab]}
						</button>
					</div>
				))}
			</div>
		</div>
	);
}

export function RightPanel({ onCollapse }: RightPanelProps) {
	const activeAgentId = useAgentsStore((state) => state.activeAgentId);
	const activeAgentName = useAgentsStore(
		(state) =>
			state.agents.find((agent) => agent.agentId === state.activeAgentId)
				?.name ?? null,
	);
	const openTab = useTabsStore((state) => state.openTab);
	const activeUpperTab = useLayoutStore((state) => state.rightPanelUpperTab);
	const setRightPanelUpperTab = useLayoutStore(
		(state) => state.setRightPanelUpperTab,
	);
	const splitRatio = useLayoutStore((state) => state.rightPanelSplitRatio);
	const setRightPanelSplitRatio = useLayoutStore(
		(state) => state.setRightPanelSplitRatio,
	);
	const rightGitGraphCollapsed = useLayoutStore(
		(state) => state.rightGitGraphCollapsed,
	);
	const setRightGitGraphCollapsed = useLayoutStore(
		(state) => state.setRightGitGraphCollapsed,
	);
	const rightTerminalCollapsed = useLayoutStore(
		(state) => state.rightTerminalCollapsed,
	);
	const setRightTerminalCollapsed = useLayoutStore(
		(state) => state.setRightTerminalCollapsed,
	);
	const terminals = useTerminalStore((state) =>
		selectAgentTerminals(state, activeAgentId),
	);
	const activeTerminalId = useTerminalStore((state) =>
		selectActiveTerminalId(state, activeAgentId),
	);
	const createTerminal = useTerminalStore((state) => state.createTerminal);
	const closeTerminal = useTerminalStore((state) => state.closeTerminal);
	const renameTerminal = useTerminalStore((state) => state.renameTerminal);
	const setActiveTerminal = useTerminalStore(
		(state) => state.setActiveTerminal,
	);
	const [tree, setTree] = useState<BrowserTreeEntry[]>([]);
	const [treeLoading, setTreeLoading] = useState(false);
	const [treeError, setTreeError] = useState<string | null>(null);
	const [gitStatus, setGitStatus] = useState<BrowserGitStatusResponse | null>(
		null,
	);
	const [gitLoading, setGitLoading] = useState(false);
	const [gitError, setGitError] = useState<string | null>(null);
	const [isResizing, setIsResizing] = useState(false);
	const [loadedTreeAgentId, setLoadedTreeAgentId] = useState<string | null>(
		null,
	);
	const [loadedTreeRevision, setLoadedTreeRevision] = useState<number | null>(
		null,
	);
	const [loadedGitRevision, setLoadedGitRevision] = useState<number | null>(
		null,
	);
	const contentRef = useRef<HTMLDivElement | null>(null);
	const treeRevision = useRightPanelRefreshStore((state) =>
		selectAgentTreeRevision(state, activeAgentId),
	);
	const gitRevision = useRightPanelRefreshStore(selectGitRevision);

	useEffect(() => {
		void treeRevision;

		if (activeUpperTab !== "files") {
			setTreeLoading(false);
			return;
		}

		if (!activeAgentId) {
			setTree([]);
			setTreeError(null);
			setTreeLoading(false);
			setLoadedTreeAgentId(null);
			setLoadedTreeRevision(null);
			return;
		}

		if (
			!shouldFetchAgentTree({
				activeAgentId,
				activeUpperTab,
				loadedAgentId: loadedTreeAgentId,
				loadedRevision: loadedTreeRevision,
				treeRevision,
			})
		) {
			return;
		}

		let cancelled = false;
		setTreeLoading(true);
		setTreeError(null);
		void fetchAgentTree(activeAgentId)
			.then((nextTree) => {
				if (!cancelled) {
					setTree(nextTree);
					setTreeError(null);
					setLoadedTreeAgentId(activeAgentId);
					setLoadedTreeRevision(treeRevision);
				}
			})
			.catch((error) => {
				if (!cancelled) {
					setTree([]);
					setTreeError(
						error instanceof Error ? error.message : "Failed to load file tree",
					);
					setLoadedTreeAgentId(activeAgentId);
					setLoadedTreeRevision(treeRevision);
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
	}, [
		activeAgentId,
		activeUpperTab,
		loadedTreeAgentId,
		loadedTreeRevision,
		treeRevision,
	]);

	useEffect(() => {
		void gitRevision;

		if (activeUpperTab !== "git") {
			setGitLoading(false);
			return;
		}

		if (
			!shouldFetchGitStatus({
				activeUpperTab,
				gitRevision,
				loadedRevision: loadedGitRevision,
			})
		) {
			return;
		}

		let cancelled = false;
		setGitLoading(true);
		setGitError(null);
		void fetchGitStatus()
			.then((nextStatus) => {
				if (!cancelled) {
					setGitStatus(nextStatus);
					setGitError(null);
					setLoadedGitRevision(gitRevision);
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
					setLoadedGitRevision(gitRevision);
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
	}, [activeUpperTab, gitRevision, loadedGitRevision]);

	const handleOpenFile = useCallback(
		(params: { agentId: string; path: string }) => {
			openTab({
				type: "file",
				id: `${params.agentId}:${params.path}`,
				agentId: params.agentId,
				path: params.path,
			});
		},
		[openTab],
	);

	const handleOpenDiff = useCallback(
		(path: string) => {
			openTab({
				type: "git-diff",
				id: `git-diff:${path}`,
				path,
			});
		},
		[openTab],
	);

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

	function renderUpperContent(tab: UpperRightPanelTab) {
		if (tab === "files") {
			return (
				<div className="flex h-full min-h-0 flex-col">
					<FileTreeHeader agentName={activeAgentName} />
					<div className="scrollbar-none min-h-0 flex-1 overflow-y-auto">
						{treeLoading ? (
							<div className="px-4 py-4 text-sm text-dark-500">
								Loading files…
							</div>
						) : treeError ? (
							<div className="px-4 py-4 text-sm text-danger">{treeError}</div>
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
				</div>
			);
		}

		if (tab === "cron") {
			return (
				<div className="h-full min-h-0 overflow-hidden">
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
					graphCollapsed={rightGitGraphCollapsed}
					status={gitStatus}
					loading={gitLoading}
					error={gitError}
					onOpenDiff={handleOpenDiff}
					onToggleGraphCollapsed={() =>
						setRightGitGraphCollapsed(!rightGitGraphCollapsed)
					}
				/>
			);
		}
	}

	const upperHeight = `${splitRatio * 100}%`;
	const lowerHeight = `${(1 - splitRatio) * 100}%`;

	return (
		<div className="flex h-full flex-col bg-dark-950">
			<RightPanelUpperTabs
				activeTab={activeUpperTab}
				onCollapse={onCollapse}
				onSelectTab={setRightPanelUpperTab}
			/>

			<div
				ref={contentRef}
				className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
			>
				<div
					style={{
						height: rightTerminalCollapsed ? undefined : upperHeight,
					}}
					className={`min-h-0 overflow-hidden ${
						isResizing ? "" : "transition-[height] duration-200"
					} ${rightTerminalCollapsed ? "flex-1" : ""}`}
				>
					<div className="h-full min-h-0 overflow-hidden">
						{renderUpperContent(activeUpperTab)}
					</div>
				</div>

				{rightTerminalCollapsed ? (
					<div className="border-t border-dark-800 px-4 py-3">
						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={() => setRightTerminalCollapsed(false)}
								className="flex items-center justify-center text-dark-500 transition-colors hover:text-dark-100"
								aria-label="Expand terminal panel"
							>
								<ChevronUp size={14} />
							</button>
							<span className="font-mono-ui text-[11px] uppercase tracking-[0.16em] text-dark-500">
								Terminal
							</span>
						</div>
					</div>
				) : (
					<>
						<button
							type="button"
							aria-label="Resize right panel split"
							onMouseDown={handleResizeMouseDown}
							className="relative h-1 shrink-0 cursor-row-resize transition-colors hover:bg-dark-600"
						>
							<div className="absolute inset-x-0 top-0 h-px bg-dark-800" />
						</button>

						<div
							style={{ height: lowerHeight }}
							className={`flex min-h-0 flex-col overflow-hidden ${
								isResizing ? "" : "transition-[height] duration-200"
							}`}
						>
							<TerminalTabs
								activeTerminalId={activeTerminalId}
								canCloseTerminals={
									activeAgentId !== null && terminals.length > 1
								}
								leadingContent={
									<button
										type="button"
										onClick={() => setRightTerminalCollapsed(true)}
										className="flex items-center justify-center text-dark-500 transition-colors hover:text-dark-100"
										aria-label="Collapse terminal panel"
									>
										<ChevronDown size={14} />
									</button>
								}
								onCloseTerminal={(terminalId) => {
									if (activeAgentId) {
										closeTerminal(activeAgentId, terminalId);
									}
								}}
								onCreateTerminal={() => {
									if (activeAgentId) {
										createTerminal(activeAgentId);
									}
								}}
								onRenameTerminal={(terminalId, name) => {
									if (activeAgentId) {
										renameTerminal(activeAgentId, terminalId, name);
									}
								}}
								onSelectTerminal={(terminalId) => {
									if (activeAgentId) {
										setActiveTerminal(activeAgentId, terminalId);
									}
								}}
								terminals={terminals}
							/>
							<div className="min-h-0 flex-1 overflow-hidden">
								<TerminalPanel agentId={activeAgentId} active />
							</div>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
