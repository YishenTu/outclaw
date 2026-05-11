import {
	ChevronDown,
	ChevronUp,
	FolderTree,
	GitBranch,
	PanelRightOpen,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
	BrowserGitStatusResponse,
	BrowserTreeEntry,
} from "../../../common/protocol.ts";
import { ActiveTabUnderline } from "../components/active-tab-underline.tsx";
import {
	FileTree,
	FileTreeHeader,
} from "../components/right-panel/file-tree.tsx";
import { GitPanel } from "../components/right-panel/git/git-panel.tsx";
import { shouldClearSelectedGitCommit } from "../components/right-panel/git/git-selection-state.ts";
import {
	applyRightPanelResizeBodyStyles,
	calculateRightPanelSplitRatio,
} from "../components/right-panel/right-panel-resize-behavior.ts";
import { TerminalPanel } from "../components/right-panel/terminal/terminal-panel.tsx";
import { TerminalTabs } from "../components/right-panel/terminal/terminal-tabs.tsx";
import {
	fetchCodingRepositoryTree,
	fetchGitStatus,
	initGitRepo,
} from "../lib/api.ts";
import { useLayoutStore } from "../stores/layout.ts";
import {
	selectActiveTerminalId,
	selectActiveTerminalTab,
	selectAgentTerminals,
	useTerminalStore,
} from "../stores/terminal.ts";
import { useCodingStore } from "./coding-store.ts";

type CodingRightTab = "files" | "git";

const TAB_LABELS: Record<CodingRightTab, string> = {
	files: "Files",
	git: "Git",
};

function getTabIcon(tab: CodingRightTab, size: number) {
	return tab === "files" ? (
		<FolderTree size={size} />
	) : (
		<GitBranch size={size} />
	);
}

interface CodingRightPanelProps {
	onCollapse?: () => void;
}

export function CodingRightPanel({ onCollapse }: CodingRightPanelProps) {
	const focusedRepositoryId = useCodingStore(
		(state) => state.focusedRepositoryId,
	);
	const repository = useCodingStore((state) =>
		state.repositories.find((entry) => entry.id === state.focusedRepositoryId),
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
		selectAgentTerminals(state, focusedRepositoryId ?? null),
	);
	const activeTerminalId = useTerminalStore((state) =>
		selectActiveTerminalId(state, focusedRepositoryId ?? null),
	);
	const activeTerminalTab = useTerminalStore((state) =>
		selectActiveTerminalTab(state, focusedRepositoryId ?? null),
	);
	const createTerminal = useTerminalStore((state) => state.createTerminal);
	const closeTerminal = useTerminalStore((state) => state.closeTerminal);
	const renameTerminal = useTerminalStore((state) => state.renameTerminal);
	const setActiveTerminal = useTerminalStore(
		(state) => state.setActiveTerminal,
	);

	const [activeTab, setActiveTab] = useState<CodingRightTab>("files");
	const [tree, setTree] = useState<BrowserTreeEntry[]>([]);
	const [treeLoading, setTreeLoading] = useState(false);
	const [treeError, setTreeError] = useState<string | null>(null);
	const [gitStatus, setGitStatus] = useState<BrowserGitStatusResponse | null>(
		null,
	);
	const [gitLoading, setGitLoading] = useState(false);
	const [gitError, setGitError] = useState<string | null>(null);
	const [selectedGitCommitSha, setSelectedGitCommitSha] = useState<
		string | null
	>(null);
	const [isResizing, setIsResizing] = useState(false);
	const contentRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!focusedRepositoryId) {
			setTree([]);
			setTreeError(null);
			setTreeLoading(false);
			return;
		}

		let cancelled = false;
		setTreeLoading(true);
		setTreeError(null);
		void fetchCodingRepositoryTree(focusedRepositoryId)
			.then((entries) => {
				if (!cancelled) {
					setTree(entries);
					setTreeError(null);
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
	}, [focusedRepositoryId]);

	useEffect(() => {
		if (!focusedRepositoryId || activeTab !== "git") {
			return;
		}

		let cancelled = false;
		setGitLoading(true);
		setGitError(null);
		void fetchGitStatus({ repositoryId: focusedRepositoryId })
			.then((status) => {
				if (!cancelled) {
					setGitStatus(status);
					setGitError(null);
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
	}, [focusedRepositoryId, activeTab]);

	useEffect(() => {
		if (
			shouldClearSelectedGitCommit({
				selectedCommitSha: selectedGitCommitSha,
				status: gitStatus,
			})
		) {
			setSelectedGitCommitSha(null);
		}
	}, [gitStatus, selectedGitCommitSha]);

	const handleInitialize = useCallback(async () => {
		if (!focusedRepositoryId) {
			return;
		}
		const status = await initGitRepo({ repositoryId: focusedRepositoryId });
		setGitStatus(status);
	}, [focusedRepositoryId]);

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
			setRightPanelSplitRatio(
				calculateRightPanelSplitRatio({
					clientY: event.clientY,
					containerHeight: rect.height,
					containerTop: rect.top,
				}),
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
		const cleanupBodyStyles = applyRightPanelResizeBodyStyles(
			document.body.style,
		);

		return () => {
			document.removeEventListener("mousemove", handleResizeMove);
			document.removeEventListener("mouseup", handleResizeUp);
			cleanupBodyStyles();
		};
	}, [handleResizeMove, handleResizeUp, isResizing]);

	const upperHeight = `${splitRatio * 100}%`;
	const lowerHeight = `${(1 - splitRatio) * 100}%`;

	const noRepoState = (
		<div className="flex h-full items-center justify-center px-6 text-center text-sm text-dark-500">
			Select a project to view files, git, and terminal.
		</div>
	);

	function renderUpperContent() {
		if (!focusedRepositoryId) {
			return noRepoState;
		}
		if (activeTab === "files") {
			return (
				<div className="flex h-full min-h-0 flex-col">
					<FileTreeHeader agentName={repository?.displayName ?? null} />
					<div className="scrollbar-none min-h-0 flex-1 overflow-y-auto">
						{treeLoading ? (
							<div className="px-4 py-4 text-sm text-dark-500">
								Loading files…
							</div>
						) : treeError ? (
							<div className="px-4 py-4 text-sm text-danger">{treeError}</div>
						) : (
							<FileTree
								agentId={focusedRepositoryId}
								entries={tree}
								onOpenFile={() => {}}
							/>
						)}
					</div>
				</div>
			);
		}
		return (
			<GitPanel
				graphCollapsed={rightGitGraphCollapsed}
				onInitialize={handleInitialize}
				status={gitStatus}
				loading={gitLoading}
				error={gitError}
				onOpenDiff={() => {}}
				onSelectCommit={setSelectedGitCommitSha}
				onToggleGraphCollapsed={() =>
					setRightGitGraphCollapsed(!rightGitGraphCollapsed)
				}
				selectedCommitSha={selectedGitCommitSha}
			/>
		);
	}

	return (
		<div className="flex h-full flex-col bg-dark-950">
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
					{(["files", "git"] as const).map((tab) => (
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
								onClick={() => setActiveTab(tab)}
								className="flex h-full items-center gap-1.5 pl-2 pr-3"
							>
								{getTabIcon(tab, 14)}
								<span>{TAB_LABELS[tab]}</span>
							</button>
						</div>
					))}
				</div>
			</div>

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
						{renderUpperContent()}
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
								activeTab={activeTerminalTab}
								canRunCommand={false}
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
									if (focusedRepositoryId) {
										closeTerminal(focusedRepositoryId, terminalId);
									}
								}}
								onCreateTerminal={() => {
									if (focusedRepositoryId) {
										createTerminal(focusedRepositoryId);
									}
								}}
								onRenameTerminal={(terminalId, name) => {
									if (focusedRepositoryId) {
										renameTerminal(focusedRepositoryId, terminalId, name);
									}
								}}
								onRunCommand={() => {}}
								onSelectRun={() => {}}
								onSelectTerminal={(terminalId) => {
									if (focusedRepositoryId) {
										setActiveTerminal(focusedRepositoryId, terminalId);
									}
								}}
								terminals={terminals}
							/>
							<div className="min-h-0 flex-1 overflow-hidden">
								{focusedRepositoryId ? (
									<TerminalPanel
										agentId={focusedRepositoryId}
										repositoryId={focusedRepositoryId}
										active={activeTerminalTab === "terminal"}
									/>
								) : (
									noRepoState
								)}
							</div>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
