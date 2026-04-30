import {
	ChevronDown,
	ChevronUp,
	Clock3,
	FolderTree,
	GitBranch,
	PanelRightOpen,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BrowserGitGraphCommit } from "../../../../common/protocol.ts";
import { requestConfigRestart } from "../../config-save-restart.ts";
import { useWs } from "../../contexts/websocket-context.tsx";
import { initGitRepo } from "../../lib/api.ts";
import { sendGitCommitPrompt } from "../../send-git-commit-prompt.ts";
import { useAgentsStore } from "../../stores/agents.ts";
import { useLayoutStore } from "../../stores/layout.ts";
import {
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
import { ActiveTabUnderline } from "../active-tab-underline.tsx";
import { CronPanel } from "./cron-panel.tsx";
import { FileTree, FileTreeHeader } from "./file-tree.tsx";
import { GitPanel } from "./git-panel.tsx";
import { shouldClearSelectedGitCommit } from "./git-selection-state.ts";
import {
	useAgentTreeLoader,
	useGitStatusLoader,
} from "./right-panel-data-loaders.ts";
import {
	UPPER_RIGHT_PANEL_TABS,
	type UpperRightPanelTab,
} from "./right-panel-layout.ts";
import {
	applyRightPanelResizeBodyStyles,
	calculateRightPanelSplitRatio,
} from "./right-panel-resize-behavior.ts";
import { TerminalPanel } from "./terminal-panel.tsx";
import {
	clearDispatchedTerminalRunRequest,
	createTerminalRunRequest,
	storeTerminalRunRequest,
	type TerminalRunRequestsByAgent,
} from "./terminal-run-coordinator.ts";
import { TerminalRunPanel } from "./terminal-run-panel.tsx";
import { TerminalTabs } from "./terminal-tabs.tsx";
import {
	resolveHeaderTerminalRunAction,
	resolveSavedTerminalRunCommand,
	useAgentTerminalRunCommand,
} from "./use-agent-terminal-run-command.ts";

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
	const [selectedGitCommitSha, setSelectedGitCommitSha] = useState<
		string | null
	>(null);
	const [runRequestsByAgent, setRunRequestsByAgent] =
		useState<TerminalRunRequestsByAgent>({});
	const contentRef = useRef<HTMLDivElement | null>(null);
	const nextRunRequestIdRef = useRef(0);
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
	const { gitError, gitLoading, gitStatus } = useGitStatusLoader({
		activeUpperTab,
		gitRevision,
	});

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

	const handleOpenCommit = useCallback(
		(commit: BrowserGitGraphCommit) => {
			openTab({
				type: "git-commit",
				id: `git-commit:${commit.sha}`,
				sha: commit.sha,
				title: commit.commit.message,
			});
		},
		[openTab],
	);

	const handleCommit = useCallback(
		() =>
			sendGitCommitPrompt({
				agent: activeAgent,
				sendPromptToAgent,
			}),
		[activeAgent, sendPromptToAgent],
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
		await runCommand.saveDraftCommand();
	}, [activeAgentId, runCommand, setActiveRunTerminal]);

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
					onCommit={handleCommit}
					onInitialize={handleInitialize}
					onOpenCommit={handleOpenCommit}
					status={gitStatus}
					loading={gitLoading}
					error={gitError}
					onOpenDiff={handleOpenDiff}
					onSelectCommit={setSelectedGitCommitSha}
					onToggleGraphCollapsed={() =>
						setRightGitGraphCollapsed(!rightGitGraphCollapsed)
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
								activeTab={activeTerminalTab}
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
							<div className="min-h-0 flex-1 overflow-hidden">
								<TerminalRunPanel
									active={activeTerminalTab === "run"}
									agentId={activeAgentId}
									command={runCommand.command}
									draftCommand={runCommand.draftCommand}
									error={runCommand.error}
									executedCommand={runTerminalCommand}
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
										activeTerminalTab === "terminal"
											? "h-full"
											: "hidden h-full"
									}
								>
									<TerminalPanel
										agentId={activeAgentId}
										active={activeTerminalTab === "terminal"}
									/>
								</div>
							</div>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
