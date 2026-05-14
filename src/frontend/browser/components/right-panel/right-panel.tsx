import {
	ChevronDown,
	Clock3,
	FolderTree,
	GitBranch,
	Inbox,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BrowserGitHistoryCommit } from "../../../../common/protocol.ts";
import { requestConfigRestart } from "../../commands/config-save-restart.ts";
import { useWs } from "../../contexts/websocket-context.tsx";
import {
	UPPER_RIGHT_PANEL_TABS,
	type UpperRightPanelTab,
} from "../../layouts/right-panel-layout.ts";
import {
	archiveAgentInboxItem,
	createAgentInboxNote,
	initGitRepo,
	restoreAgentInboxItem,
} from "../../lib/api.ts";
import { useOpenDoc } from "../../lib/use-open-doc.ts";
import { sendGitCommitPrompt } from "../../prompts/send-git-commit-prompt.ts";
import { useAgentsStore } from "../../stores/agents.ts";
import { useLayoutStore } from "../../stores/layout.ts";
import {
	selectAgentInboxRevision,
	selectAgentTreeRevision,
	selectGitRevision,
	useRightPanelRefreshStore,
} from "../../stores/right-panel-refresh.ts";
import { useTabsStore } from "../../stores/tabs.ts";
import {
	selectActiveTerminalId,
	selectActiveTerminalTab,
	selectAgentTerminals,
	selectRunTerminalCommand,
	useTerminalStore,
} from "../../stores/terminal.ts";
import { CronPanel } from "./cron-panel.tsx";
import { type FilesViewMode, FileTree, FileTreeHeader } from "./file-tree.tsx";
import { GitPanel } from "./git/git-panel.tsx";
import { shouldClearSelectedGitCommit } from "./git/git-selection-state.ts";
import { GraphView } from "./graph-view.tsx";
import { InboxPanel, type InboxUndoArchive } from "./inbox-panel.tsx";
import {
	useAgentTreeLoader,
	useGitStatusLoader,
	useInboxLoader,
} from "./right-panel-data-loaders.ts";
import {
	applyRightPanelResizeBodyStyles,
	calculateRightPanelSplitRatio,
} from "./right-panel-resize-behavior.ts";
import {
	RightPanelSplitShell,
	RightPanelTabBar,
} from "./right-panel-shell.tsx";
import { TerminalPanel } from "./terminal/terminal-panel.tsx";
import {
	clearDispatchedTerminalRunRequest,
	createTerminalRunRequest,
	storeTerminalRunRequest,
	type TerminalRunRequestsByAgent,
} from "./terminal/terminal-run-coordinator.ts";
import { TerminalRunPanel } from "./terminal/terminal-run-panel.tsx";
import { TerminalTabs } from "./terminal/terminal-tabs.tsx";
import {
	resolveHeaderTerminalRunAction,
	resolveSavedTerminalRunCommand,
	useAgentTerminalRunCommand,
} from "./terminal/use-agent-terminal-run-command.ts";

const TAB_LABELS: Record<UpperRightPanelTab, string> = {
	inbox: "Inbox",
	files: "Files",
	cron: "Cron",
	git: "Git",
};

const INBOX_UNDO_DURATION_MS = 10_000;

interface RightPanelProps {
	onCollapse?: () => void;
}

function getTabIcon(tab: UpperRightPanelTab, size: number) {
	if (tab === "inbox") {
		return <Inbox size={size} />;
	}
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
	inboxCount = 0,
	onCollapse,
	onSelectTab,
}: {
	activeTab: UpperRightPanelTab;
	inboxCount?: number;
	onCollapse?: () => void;
	onSelectTab: (tab: UpperRightPanelTab) => void;
}) {
	return (
		<RightPanelTabBar
			activeTab={activeTab}
			tabs={UPPER_RIGHT_PANEL_TABS.map((tab) => ({
				id: tab,
				label: TAB_LABELS[tab],
				icon: getTabIcon(tab, 14),
				...(tab === "inbox" ? { badge: inboxCount } : {}),
			}))}
			onCollapse={onCollapse}
			onSelectTab={onSelectTab}
		/>
	);
}

export function RightPanel({ onCollapse }: RightPanelProps) {
	const { sendCommand, sendPromptToAgent } = useWs();
	const requestRestartAfterConfigSave = useCallback(
		() => requestConfigRestart(sendCommand),
		[sendCommand],
	);
	const activeAgentId = useAgentsStore((state) => state.activeAgentId);
	const activeAgent = useAgentsStore(
		(state) =>
			state.agents.find((agent) => agent.agentId === state.activeAgentId) ??
			null,
	);
	const activeAgentName = activeAgent?.name ?? null;
	const openDoc = useOpenDoc();
	const activeFilePathForGraph = useTabsStore((state) => {
		if (!activeAgentId) {
			return null;
		}
		const active = state.tabs.find((tab) => tab.id === state.activeTabId);
		if (!active || active.type !== "file" || active.agentId !== activeAgentId) {
			return null;
		}
		return active.path;
	});
	const activeUpperTab = useLayoutStore((state) => state.rightPanelUpperTab);
	const setRightPanelUpperTab = useLayoutStore(
		(state) => state.setRightPanelUpperTab,
	);
	const splitRatio = useLayoutStore((state) => state.rightPanelSplitRatio);
	const setRightPanelSplitRatio = useLayoutStore(
		(state) => state.setRightPanelSplitRatio,
	);
	const rightGitHistoryCollapsed = useLayoutStore(
		(state) => state.rightGitHistoryCollapsed,
	);
	const setRightGitHistoryCollapsed = useLayoutStore(
		(state) => state.setRightGitHistoryCollapsed,
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
	const activeTerminalTab = useTerminalStore((state) =>
		selectActiveTerminalTab(state, activeAgentId),
	);
	const runTerminalCommand = useTerminalStore((state) =>
		selectRunTerminalCommand(state, activeAgentId),
	);
	const createTerminal = useTerminalStore((state) => state.createTerminal);
	const closeTerminal = useTerminalStore((state) => state.closeTerminal);
	const executeRunTerminal = useTerminalStore(
		(state) => state.executeRunTerminal,
	);
	const renameTerminal = useTerminalStore((state) => state.renameTerminal);
	const setActiveRunTerminal = useTerminalStore(
		(state) => state.setActiveRunTerminal,
	);
	const setActiveTerminal = useTerminalStore(
		(state) => state.setActiveTerminal,
	);
	const runCommand = useAgentTerminalRunCommand(
		activeAgentId,
		activeAgent?.terminalRunCommand ?? "",
		requestRestartAfterConfigSave,
	);
	const [isResizing, setIsResizing] = useState(false);
	const [filesViewMode, setFilesViewMode] = useState<FilesViewMode>("tree");
	const [selectedGitCommitSha, setSelectedGitCommitSha] = useState<
		string | null
	>(null);
	const [inboxActionError, setInboxActionError] = useState<string | null>(null);
	const [undoArchive, setUndoArchive] = useState<InboxUndoArchive | null>(null);
	const [runRequestsByAgent, setRunRequestsByAgent] =
		useState<TerminalRunRequestsByAgent>({});
	const [editingRunCommandAgentId, setEditingRunCommandAgentId] = useState<
		string | null
	>(null);
	const contentRef = useRef<HTMLDivElement | null>(null);
	const nextRunRequestIdRef = useRef(0);
	const previousInboxAgentIdRef = useRef<string | null>(activeAgentId);
	const undoArchiveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const inboxRevision = useRightPanelRefreshStore((state) =>
		selectAgentInboxRevision(state, activeAgentId),
	);
	const treeRevision = useRightPanelRefreshStore((state) =>
		selectAgentTreeRevision(state, activeAgentId),
	);
	const gitRevision = useRightPanelRefreshStore(selectGitRevision);
	const bumpGitRevision = useRightPanelRefreshStore(
		(state) => state.bumpGitRevision,
	);
	const bumpTreeRevision = useRightPanelRefreshStore(
		(state) => state.bumpTreeRevision,
	);
	const { tree, treeError, treeLoading } = useAgentTreeLoader({
		activeAgentId,
		activeUpperTab,
		gitRevision,
		treeRevision,
	});
	const {
		gitError,
		gitHistoryLoadError,
		gitHistoryLoadingMore,
		gitLoading,
		gitStatus,
		loadMoreGitHistory,
	} = useGitStatusLoader({
		active: activeUpperTab === "git",
		gitRevision,
	});
	const { inbox, inboxError, inboxLoading } = useInboxLoader({
		activeAgentId,
		inboxRevision,
	});

	const clearUndoArchiveTimer = useCallback(() => {
		if (!undoArchiveTimerRef.current) {
			return;
		}
		clearTimeout(undoArchiveTimerRef.current);
		undoArchiveTimerRef.current = null;
	}, []);

	useEffect(
		() => () => {
			clearUndoArchiveTimer();
		},
		[clearUndoArchiveTimer],
	);

	useEffect(() => {
		if (previousInboxAgentIdRef.current === activeAgentId) {
			return;
		}
		previousInboxAgentIdRef.current = activeAgentId;
		clearUndoArchiveTimer();
		setUndoArchive(null);
		setInboxActionError(null);
	}, [activeAgentId, clearUndoArchiveTimer]);

	useEffect(() => {
		if (
			editingRunCommandAgentId === null ||
			editingRunCommandAgentId === activeAgentId
		) {
			return;
		}
		setEditingRunCommandAgentId(null);
	}, [activeAgentId, editingRunCommandAgentId]);

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

	const handleOpenFile = useCallback(
		(params: { agentId: string; path: string }) => {
			openDoc({
				type: "file",
				id: `${params.agentId}:${params.path}`,
				agentId: params.agentId,
				path: params.path,
			});
		},
		[openDoc],
	);

	const handleOpenDiff = useCallback(
		(path: string) => {
			openDoc({
				type: "git-diff",
				id: `git-diff:${path}`,
				path,
			});
		},
		[openDoc],
	);

	const handleOpenCommit = useCallback(
		(commit: BrowserGitHistoryCommit) => {
			openDoc({
				type: "git-commit",
				id: `git-commit:${commit.sha}`,
				sha: commit.sha,
				title: commit.commit.message,
			});
		},
		[openDoc],
	);

	const handleCommit = useCallback(
		() =>
			sendGitCommitPrompt({
				agent: activeAgent,
				sendPromptToAgent,
			}),
		[activeAgent, sendPromptToAgent],
	);

	const scheduleUndoArchiveExpiry = useCallback(() => {
		clearUndoArchiveTimer();
		undoArchiveTimerRef.current = setTimeout(() => {
			setUndoArchive(null);
			undoArchiveTimerRef.current = null;
		}, INBOX_UNDO_DURATION_MS);
	}, [clearUndoArchiveTimer]);

	const handleArchiveInboxItem = useCallback(
		async (path: string) => {
			if (!activeAgentId) {
				return;
			}

			try {
				const result = await archiveAgentInboxItem(activeAgentId, path);
				setInboxActionError(null);
				setUndoArchive({
					archivedPath: result.archivedPath,
					expiresAtMs: Date.now() + INBOX_UNDO_DURATION_MS,
					name: result.item.name,
					originalPath: result.originalPath,
				});
				scheduleUndoArchiveExpiry();
			} catch (error) {
				setInboxActionError(
					error instanceof Error ? error.message : "Failed to archive item",
				);
			}
		},
		[activeAgentId, scheduleUndoArchiveExpiry],
	);

	const handleUndoArchiveInboxItem = useCallback(async () => {
		if (!activeAgentId || !undoArchive) {
			return;
		}

		try {
			await restoreAgentInboxItem(
				activeAgentId,
				undoArchive.archivedPath,
				undoArchive.originalPath,
			);
			setInboxActionError(null);
			setUndoArchive(null);
			clearUndoArchiveTimer();
		} catch (error) {
			setInboxActionError(
				error instanceof Error ? error.message : "Failed to restore item",
			);
		}
	}, [activeAgentId, clearUndoArchiveTimer, undoArchive]);

	const handleCreateInboxNote = useCallback(
		async (input: { body: string; title: string }) => {
			if (!activeAgentId) {
				return;
			}

			try {
				await createAgentInboxNote(activeAgentId, input);
				setInboxActionError(null);
			} catch (error) {
				setInboxActionError(
					error instanceof Error ? error.message : "Failed to create note",
				);
				throw error;
			}
		},
		[activeAgentId],
	);

	const handleInitialize = useCallback(async () => {
		await initGitRepo();
		if (activeAgentId) {
			bumpTreeRevision(activeAgentId);
		}
		bumpGitRevision();
	}, [activeAgentId, bumpGitRevision, bumpTreeRevision]);

	const dispatchRunCommand = useCallback(
		(agentId: string, command: string) => {
			executeRunTerminal(agentId, command);
			const { nextRequestId, request } = createTerminalRunRequest({
				command,
				nextRequestId: nextRunRequestIdRef.current,
			});
			nextRunRequestIdRef.current = nextRequestId;
			setRunRequestsByAgent((current) =>
				storeTerminalRunRequest(current, agentId, request),
			);
		},
		[executeRunTerminal],
	);

	const handleHeaderRunCommand = useCallback(() => {
		if (!activeAgentId) {
			return;
		}

		const agentId = activeAgentId;
		setActiveRunTerminal(agentId);

		const action = resolveHeaderTerminalRunAction({
			command: runCommand.command,
		});

		if (action.type === "select") {
			return;
		}

		dispatchRunCommand(agentId, action.command);
	}, [
		activeAgentId,
		dispatchRunCommand,
		runCommand.command,
		setActiveRunTerminal,
	]);

	const handleRunPanelCommand = useCallback(async () => {
		if (!activeAgentId) {
			return;
		}

		const agentId = activeAgentId;
		setActiveRunTerminal(agentId);

		const command = resolveSavedTerminalRunCommand(runCommand.command);
		if (!command) {
			return;
		}

		dispatchRunCommand(agentId, command);
	}, [activeAgentId, dispatchRunCommand, runCommand, setActiveRunTerminal]);

	const handleRunPanelSaveCommand = useCallback(async () => {
		if (!activeAgentId) {
			return;
		}

		setActiveRunTerminal(activeAgentId);
		const savedCommand = await runCommand.saveDraftCommand();
		if (savedCommand) {
			setEditingRunCommandAgentId(null);
		}
	}, [activeAgentId, runCommand, setActiveRunTerminal]);

	const handleEditRunCommand = useCallback(() => {
		if (!activeAgentId) {
			return;
		}
		setActiveRunTerminal(activeAgentId);
		runCommand.setDraftCommand(runCommand.command);
		setEditingRunCommandAgentId(activeAgentId);
	}, [activeAgentId, runCommand, setActiveRunTerminal]);

	const handleCancelEditRunCommand = useCallback(() => {
		runCommand.setDraftCommand(runCommand.command);
		setEditingRunCommandAgentId(null);
	}, [runCommand]);

	const handleRunRequestDispatched = useCallback(
		(requestId: number) => {
			if (!activeAgentId) {
				return;
			}

			setRunRequestsByAgent((current) =>
				clearDispatchedTerminalRunRequest(current, activeAgentId, requestId),
			);
		},
		[activeAgentId],
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

	function renderUpperContent(tab: UpperRightPanelTab) {
		if (tab === "inbox") {
			return (
				<div className="h-full min-h-0 overflow-hidden">
					{activeAgentId ? (
						<InboxPanel
							agentId={activeAgentId}
							agentName={activeAgentName}
							error={inboxActionError ?? inboxError}
							inbox={inbox}
							loading={inboxLoading}
							onArchive={(path) => {
								void handleArchiveInboxItem(path);
							}}
							onCreateNote={handleCreateInboxNote}
							onOpenFile={handleOpenFile}
							onUndoArchive={() => {
								void handleUndoArchiveInboxItem();
							}}
							undoArchive={undoArchive}
						/>
					) : (
						<div className="px-4 py-4 text-sm text-dark-500">
							No active agent.
						</div>
					)}
				</div>
			);
		}

		if (tab === "files") {
			const isGraph = filesViewMode === "graph";
			// Both panes stay mounted and toggle via CSS so the graph keeps its
			// simulation, pan/zoom, and forces state when the user flips back to
			// the file tree. Conditional rendering would unmount GraphView and
			// force a fresh layout fit on every toggle.
			return (
				<div className="flex h-full min-h-0 flex-col">
					<FileTreeHeader
						agentName={activeAgentName}
						viewMode={filesViewMode}
						onToggleViewMode={() =>
							setFilesViewMode(isGraph ? "tree" : "graph")
						}
					/>
					<div
						className={`min-h-0 flex-1 overflow-hidden ${
							isGraph ? "" : "hidden"
						}`}
					>
						{activeAgentId ? (
							<GraphView
								agentId={activeAgentId}
								treeRevision={treeRevision}
								isVisible={isGraph}
								activeFilePath={activeFilePathForGraph}
								onOpenFile={handleOpenFile}
							/>
						) : (
							<div className="px-4 py-4 text-sm text-dark-500">
								No active agent.
							</div>
						)}
					</div>
					<div
						className={`scrollbar-none min-h-0 flex-1 overflow-y-auto ${
							isGraph ? "hidden" : ""
						}`}
					>
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
							key={activeAgentId}
							agentId={activeAgentId}
							treeEntries={tree}
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
					historyCollapsed={rightGitHistoryCollapsed}
					onCommit={handleCommit}
					onInitialize={handleInitialize}
					onOpenCommit={handleOpenCommit}
					onLoadMoreHistory={loadMoreGitHistory}
					status={gitStatus}
					historyLoadError={gitHistoryLoadError}
					historyLoadingMore={gitHistoryLoadingMore}
					loading={gitLoading}
					error={gitError}
					onOpenDiff={handleOpenDiff}
					onSelectCommit={setSelectedGitCommitSha}
					onToggleHistoryCollapsed={() =>
						setRightGitHistoryCollapsed(!rightGitHistoryCollapsed)
					}
					selectedCommitSha={selectedGitCommitSha}
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
				inboxCount={inbox?.pendingCount ?? 0}
				onCollapse={onCollapse}
				onSelectTab={setRightPanelUpperTab}
			/>

			<RightPanelSplitShell
				contentRef={contentRef}
				upperHeight={upperHeight}
				lowerHeight={lowerHeight}
				lowerCollapsed={rightTerminalCollapsed}
				isResizing={isResizing}
				onResizeMouseDown={handleResizeMouseDown}
				onExpandLower={() => setRightTerminalCollapsed(false)}
				upperContent={renderUpperContent(activeUpperTab)}
				lowerHeader={
					<TerminalTabs
						activeTerminalId={activeTerminalId}
						activeTab={activeTerminalTab}
						canEditRunCommand={Boolean(activeAgentId) && !runCommand.saving}
						canRunCommand={Boolean(activeAgentId) && !runCommand.saving}
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
						onEditRunCommand={handleEditRunCommand}
						onRenameTerminal={(terminalId, name) => {
							if (activeAgentId) {
								renameTerminal(activeAgentId, terminalId, name);
							}
						}}
						onRunCommand={() => {
							handleHeaderRunCommand();
						}}
						onSelectRun={() => {
							if (activeAgentId) {
								setActiveRunTerminal(activeAgentId);
							}
						}}
						onSelectTerminal={(terminalId) => {
							if (activeAgentId) {
								setActiveTerminal(activeAgentId, terminalId);
							}
						}}
						terminals={terminals}
					/>
				}
				lowerContent={
					<>
						<TerminalRunPanel
							active={activeTerminalTab === "run"}
							agentId={activeAgentId}
							command={runCommand.command}
							draftCommand={runCommand.draftCommand}
							editingCommand={editingRunCommandAgentId === activeAgentId}
							error={runCommand.error}
							executedCommand={runTerminalCommand}
							onCancelEditCommand={handleCancelEditRunCommand}
							onDraftCommandChange={runCommand.setDraftCommand}
							onRun={() => {
								void handleRunPanelCommand();
							}}
							onSave={() => {
								void handleRunPanelSaveCommand();
							}}
							onRunRequestDispatched={handleRunRequestDispatched}
							runRequest={
								activeAgentId
									? (runRequestsByAgent[activeAgentId] ?? null)
									: null
							}
							saving={runCommand.saving}
						/>
						<div
							className={
								activeTerminalTab === "terminal" ? "h-full" : "hidden h-full"
							}
						>
							<TerminalPanel
								agentId={activeAgentId}
								active={activeTerminalTab === "terminal"}
							/>
						</div>
					</>
				}
			/>
		</div>
	);
}
