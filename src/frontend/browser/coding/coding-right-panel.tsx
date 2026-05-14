import { ChevronDown, FolderTree, GitBranch } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
	BrowserCodingRepositorySummary,
	BrowserCodingSessionSummary,
	BrowserTreeEntry,
} from "../../../common/protocol.ts";
import {
	FileTree,
	FileTreeHeader,
} from "../components/right-panel/file-tree.tsx";
import { GitPanel } from "../components/right-panel/git/git-panel.tsx";
import { shouldClearSelectedGitCommit } from "../components/right-panel/git/git-selection-state.ts";
import { useGitStatusLoader } from "../components/right-panel/right-panel-data-loaders.ts";
import {
	applyRightPanelResizeBodyStyles,
	calculateRightPanelSplitRatio,
} from "../components/right-panel/right-panel-resize-behavior.ts";
import {
	RightPanelSplitShell,
	RightPanelTabBar,
} from "../components/right-panel/right-panel-shell.tsx";
import { TerminalPanel } from "../components/right-panel/terminal/terminal-panel.tsx";
import {
	clearDispatchedTerminalRunRequest,
	createTerminalRunRequest,
	storeTerminalRunRequest,
	type TerminalRunRequestsByAgent,
} from "../components/right-panel/terminal/terminal-run-coordinator.ts";
import { TerminalRunPanel } from "../components/right-panel/terminal/terminal-run-panel.tsx";
import { TerminalTabs } from "../components/right-panel/terminal/terminal-tabs.tsx";
import {
	resolveHeaderTerminalRunAction,
	resolveSavedTerminalRunCommand,
	useTerminalRunCommand,
} from "../components/right-panel/terminal/use-agent-terminal-run-command.ts";
import {
	fetchCodingRepositoryTree,
	initGitRepo,
	updateCodingRepositoryTerminalRunCommand,
} from "../lib/api.ts";
import { useLayoutStore } from "../stores/layout.ts";
import {
	selectGitRevision,
	useRightPanelRefreshStore,
} from "../stores/right-panel-refresh.ts";
import {
	selectActiveTerminalId,
	selectActiveTerminalTab,
	selectAgentTerminals,
	selectRunTerminalCommand,
	useTerminalStore,
} from "../stores/terminal.ts";
import {
	isCodingDiffTab,
	isCodingFileTab,
	isPendingCodingTab,
	makeCodingDiffTab,
	makeCodingFileTab,
	useCodingStore,
} from "./coding-store.ts";

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
	const focusedSession = useCodingStore((state) => state.focusedSession);
	const sessionsByRepository = useCodingStore(
		(state) => state.sessionsByRepository,
	);
	const repository = useCodingStore((state) =>
		state.repositories.find((entry) => entry.id === state.focusedRepositoryId),
	);
	const sessions = focusedRepositoryId
		? (sessionsByRepository[focusedRepositoryId] ?? [])
		: [];
	const repositorySessionsLoaded = focusedRepositoryId
		? Object.hasOwn(sessionsByRepository, focusedRepositoryId)
		: false;
	const workspaceTarget = resolveCodingRightPanelWorkspaceTarget({
		focusedRepositoryId,
		focusedSession,
		repository,
		repositorySessionsLoaded,
		sessions,
	});
	const workspaceKey = workspaceTarget?.workspaceKey;
	const latestWorkspaceTarget = useRef(workspaceTarget);
	latestWorkspaceTarget.current = workspaceTarget;
	const openCodingTab = useCodingStore((state) => state.openTab);
	const handleOpenFile = useCallback(
		(params: { agentId: string; path: string }) => {
			if (!focusedRepositoryId) {
				return;
			}
			openCodingTab(makeCodingFileTab(focusedRepositoryId, params.path));
		},
		[focusedRepositoryId, openCodingTab],
	);
	const handleOpenDiff = useCallback(
		(path: string) => {
			if (!focusedRepositoryId) {
				return;
			}
			openCodingTab(makeCodingDiffTab(focusedRepositoryId, path));
		},
		[focusedRepositoryId, openCodingTab],
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
	const terminalWorkspaceKey = workspaceKey ?? null;
	const terminals = useTerminalStore((state) =>
		selectAgentTerminals(state, terminalWorkspaceKey),
	);
	const activeTerminalId = useTerminalStore((state) =>
		selectActiveTerminalId(state, terminalWorkspaceKey),
	);
	const activeTerminalTab = useTerminalStore((state) =>
		selectActiveTerminalTab(state, terminalWorkspaceKey),
	);
	const runTerminalCommand = useTerminalStore((state) =>
		selectRunTerminalCommand(state, terminalWorkspaceKey),
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
	const updateRepository = useCodingStore((state) => state.updateRepository);
	const runCommand = useTerminalRunCommand(
		focusedRepositoryId ?? null,
		repository?.terminalRunCommand ?? "",
		updateCodingRepositoryTerminalRunCommand,
	);

	const [activeTab, setActiveTab] = useState<CodingRightTab>("files");
	const [tree, setTree] = useState<BrowserTreeEntry[]>([]);
	const [treeLoading, setTreeLoading] = useState(false);
	const [treeError, setTreeError] = useState<string | null>(null);
	const loadingTreeDirectoriesRef = useRef(new Set<string>());
	const latestWorkspaceKey = useRef(workspaceKey);
	const [selectedGitCommitSha, setSelectedGitCommitSha] = useState<
		string | null
	>(null);
	const gitRevision = useRightPanelRefreshStore(selectGitRevision);
	const {
		acceptGitStatus,
		gitError,
		gitHistoryLoadError,
		gitHistoryLoadingMore,
		gitLoading,
		gitStatus,
		loadMoreGitHistory,
	} = useGitStatusLoader({
		active: activeTab === "git" && workspaceKey !== undefined,
		gitRevision,
		providerId: workspaceTarget?.providerId,
		repositoryId: workspaceTarget?.repositoryId,
		sdkSessionId: workspaceTarget?.sdkSessionId,
		workspaceKey,
	});
	const [isResizing, setIsResizing] = useState(false);
	const [runRequestsByWorkspace, setRunRequestsByWorkspace] =
		useState<TerminalRunRequestsByAgent>({});
	const [editingRunCommandRepositoryId, setEditingRunCommandRepositoryId] =
		useState<string | null>(null);
	const contentRef = useRef<HTMLDivElement | null>(null);
	const nextRunRequestIdRef = useRef(0);
	if (latestWorkspaceKey.current !== workspaceKey) {
		loadingTreeDirectoriesRef.current.clear();
		latestWorkspaceKey.current = workspaceKey;
	}

	useEffect(() => {
		if (!workspaceKey) {
			setTree([]);
			setTreeError(null);
			setTreeLoading(false);
			return;
		}
		if (
			!shouldLoadCodingRepositoryTree({
				activeTab,
				focusedWorkspaceKey: workspaceKey,
			})
		) {
			return;
		}

		const requestTarget = latestWorkspaceTarget.current;
		if (!requestTarget) {
			return;
		}
		let cancelled = false;
		setTreeLoading(true);
		setTreeError(null);
		void fetchCodingRepositoryTree(
			requestTarget.repositoryId,
			undefined,
			workspaceSessionParams(requestTarget),
		)
			.then((entries) => {
				if (!cancelled) {
					setTree(entries);
					setTreeError(null);
					loadingTreeDirectoriesRef.current.clear();
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
	}, [activeTab, workspaceKey]);

	const handleOpenTreeDirectory = useCallback(
		(params: { path: string }) => {
			const requestTarget = latestWorkspaceTarget.current;
			const requestWorkspaceKey = requestTarget?.workspaceKey;
			if (
				!requestTarget ||
				!requestWorkspaceKey ||
				loadingTreeDirectoriesRef.current.has(params.path)
			) {
				return;
			}
			if (treeDirectoryLoaded(tree, params.path)) {
				return;
			}
			loadingTreeDirectoriesRef.current.add(params.path);
			void fetchCodingRepositoryTree(
				requestTarget.repositoryId,
				params.path,
				workspaceSessionParams(requestTarget),
			)
				.then((entries) => {
					if (
						!shouldApplyCodingRepositoryDirectoryChildren({
							focusedWorkspaceKey: latestWorkspaceKey.current,
							requestWorkspaceKey,
						})
					) {
						return;
					}
					setTree((current) =>
						mergeTreeDirectoryChildren(current, params.path, entries),
					);
				})
				.catch((error) => {
					console.warn("Failed to load coding repository directory", error);
				})
				.finally(() => {
					loadingTreeDirectoriesRef.current.delete(params.path);
				});
		},
		[tree],
	);

	useEffect(() => {
		void workspaceKey;
		setSelectedGitCommitSha(null);
	}, [workspaceKey]);

	useEffect(() => {
		if (
			editingRunCommandRepositoryId === null ||
			editingRunCommandRepositoryId === focusedRepositoryId
		) {
			return;
		}
		setEditingRunCommandRepositoryId(null);
	}, [editingRunCommandRepositoryId, focusedRepositoryId]);

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
		const target = latestWorkspaceTarget.current;
		if (!target) {
			return;
		}
		const status = await initGitRepo({
			repositoryId: target.repositoryId,
			...workspaceSessionParams(target),
		});
		acceptGitStatus(status);
	}, [acceptGitStatus]);

	const dispatchRunCommand = useCallback(
		(workspaceKey: string, command: string) => {
			executeRunTerminal(workspaceKey, command);
			const { nextRequestId, request } = createTerminalRunRequest({
				command,
				nextRequestId: nextRunRequestIdRef.current,
			});
			nextRunRequestIdRef.current = nextRequestId;
			setRunRequestsByWorkspace((current) =>
				storeTerminalRunRequest(current, workspaceKey, request),
			);
		},
		[executeRunTerminal],
	);

	const handleHeaderRunCommand = useCallback(() => {
		if (!terminalWorkspaceKey) {
			return;
		}

		setActiveRunTerminal(terminalWorkspaceKey);
		const action = resolveHeaderTerminalRunAction({
			command: runCommand.command,
		});
		if (action.type === "select") {
			return;
		}

		dispatchRunCommand(terminalWorkspaceKey, action.command);
	}, [
		dispatchRunCommand,
		runCommand.command,
		setActiveRunTerminal,
		terminalWorkspaceKey,
	]);

	const handleRunPanelCommand = useCallback(() => {
		if (!terminalWorkspaceKey) {
			return;
		}

		setActiveRunTerminal(terminalWorkspaceKey);
		const command = resolveSavedTerminalRunCommand(runCommand.command);
		if (!command) {
			return;
		}

		dispatchRunCommand(terminalWorkspaceKey, command);
	}, [
		dispatchRunCommand,
		runCommand.command,
		setActiveRunTerminal,
		terminalWorkspaceKey,
	]);

	const handleRunPanelSaveCommand = useCallback(async () => {
		if (!repository || !terminalWorkspaceKey) {
			return;
		}

		setActiveRunTerminal(terminalWorkspaceKey);
		const savedCommand = await runCommand.saveDraftCommand();
		if (!savedCommand) {
			return;
		}
		updateRepository({
			...repository,
			terminalRunCommand: savedCommand,
		});
		setEditingRunCommandRepositoryId(null);
	}, [
		repository,
		runCommand,
		setActiveRunTerminal,
		terminalWorkspaceKey,
		updateRepository,
	]);

	const handleEditRunCommand = useCallback(() => {
		if (!focusedRepositoryId || !terminalWorkspaceKey) {
			return;
		}

		setActiveRunTerminal(terminalWorkspaceKey);
		runCommand.setDraftCommand(runCommand.command);
		setEditingRunCommandRepositoryId(focusedRepositoryId);
	}, [
		focusedRepositoryId,
		runCommand,
		setActiveRunTerminal,
		terminalWorkspaceKey,
	]);

	const handleCancelEditRunCommand = useCallback(() => {
		runCommand.setDraftCommand(runCommand.command);
		setEditingRunCommandRepositoryId(null);
	}, [runCommand]);

	const handleRunRequestDispatched = useCallback(
		(requestId: number) => {
			if (!terminalWorkspaceKey) {
				return;
			}

			setRunRequestsByWorkspace((current) =>
				clearDispatchedTerminalRunRequest(
					current,
					terminalWorkspaceKey,
					requestId,
				),
			);
		},
		[terminalWorkspaceKey],
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

	const upperHeight = `${splitRatio * 100}%`;
	const lowerHeight = `${(1 - splitRatio) * 100}%`;
	const noRepoState = (
		<div className="flex h-full items-center justify-center px-6 text-center text-sm text-dark-500">
			Select a project to view files, git, and terminal.
		</div>
	);
	const workspaceLoadingState = (
		<div className="flex h-full items-center justify-center px-6 text-center text-sm text-dark-500">
			Loading workspace…
		</div>
	);

	function renderUpperContent() {
		if (!focusedRepositoryId) {
			return noRepoState;
		}
		if (!workspaceTarget) {
			return workspaceLoadingState;
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
								agentId={workspaceTarget.workspaceKey}
								entries={tree}
								onOpenDirectory={handleOpenTreeDirectory}
								onOpenFile={handleOpenFile}
							/>
						)}
					</div>
				</div>
			);
		}
		return (
			<GitPanel
				gitScope={{
					repositoryId: workspaceTarget.repositoryId,
					...(workspaceTarget.providerId
						? { providerId: workspaceTarget.providerId }
						: {}),
					...(workspaceTarget.sdkSessionId
						? { sdkSessionId: workspaceTarget.sdkSessionId }
						: {}),
					workspaceKey: workspaceTarget.workspaceKey,
				}}
				historyCollapsed={rightGitHistoryCollapsed}
				historyLoadError={gitHistoryLoadError}
				historyLoadingMore={gitHistoryLoadingMore}
				onInitialize={handleInitialize}
				onLoadMoreHistory={loadMoreGitHistory}
				status={gitStatus}
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

	return (
		<div className="flex h-full flex-col bg-dark-950">
			<RightPanelTabBar
				activeTab={activeTab}
				tabs={(["files", "git"] as const).map((tab) => ({
					id: tab,
					label: TAB_LABELS[tab],
					icon: getTabIcon(tab, 14),
				}))}
				onCollapse={onCollapse}
				onSelectTab={setActiveTab}
			/>

			<RightPanelSplitShell
				contentRef={contentRef}
				upperHeight={upperHeight}
				lowerHeight={lowerHeight}
				lowerCollapsed={rightTerminalCollapsed}
				isResizing={isResizing}
				onResizeMouseDown={handleResizeMouseDown}
				onExpandLower={() => setRightTerminalCollapsed(false)}
				upperContent={renderUpperContent()}
				lowerHeader={
					<TerminalTabs
						activeTerminalId={activeTerminalId}
						activeTab={activeTerminalTab}
						canEditRunCommand={shouldEnableCodingRunCommand({
							saving: runCommand.saving,
							workspaceKey: workspaceKey,
						})}
						canRunCommand={shouldEnableCodingRunCommand({
							saving: runCommand.saving,
							workspaceKey: workspaceKey,
						})}
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
							if (terminalWorkspaceKey) {
								closeTerminal(terminalWorkspaceKey, terminalId);
							}
						}}
						onCreateTerminal={() => {
							if (terminalWorkspaceKey) {
								createTerminal(terminalWorkspaceKey);
							}
						}}
						onEditRunCommand={handleEditRunCommand}
						onRenameTerminal={(terminalId, name) => {
							if (terminalWorkspaceKey) {
								renameTerminal(terminalWorkspaceKey, terminalId, name);
							}
						}}
						onRunCommand={handleHeaderRunCommand}
						onSelectRun={() => {
							if (terminalWorkspaceKey) {
								setActiveRunTerminal(terminalWorkspaceKey);
							}
						}}
						onSelectTerminal={(terminalId) => {
							if (terminalWorkspaceKey) {
								setActiveTerminal(terminalWorkspaceKey, terminalId);
							}
						}}
						terminals={terminals}
					/>
				}
				lowerContent={
					workspaceTarget ? (
						<>
							<TerminalRunPanel
								active={activeTerminalTab === "run"}
								agentId={workspaceTarget.workspaceKey}
								command={runCommand.command}
								draftCommand={runCommand.draftCommand}
								editingCommand={
									editingRunCommandRepositoryId === workspaceTarget.repositoryId
								}
								error={runCommand.error}
								executedCommand={runTerminalCommand}
								onCancelEditCommand={handleCancelEditRunCommand}
								onDraftCommandChange={runCommand.setDraftCommand}
								onRun={handleRunPanelCommand}
								onSave={() => {
									void handleRunPanelSaveCommand();
								}}
								onRunRequestDispatched={handleRunRequestDispatched}
								providerId={workspaceTarget.providerId}
								repositoryId={workspaceTarget.repositoryId}
								runRequest={
									runRequestsByWorkspace[workspaceTarget.workspaceKey] ?? null
								}
								saving={runCommand.saving}
								sdkSessionId={workspaceTarget.sdkSessionId}
							/>
							<div
								className={
									activeTerminalTab === "terminal" ? "h-full" : "hidden h-full"
								}
							>
								<TerminalPanel
									agentId={workspaceTarget.workspaceKey}
									active={activeTerminalTab === "terminal"}
									providerId={workspaceTarget.providerId}
									repositoryId={workspaceTarget.repositoryId}
									sdkSessionId={workspaceTarget.sdkSessionId}
								/>
							</div>
						</>
					) : focusedRepositoryId ? (
						workspaceLoadingState
					) : (
						noRepoState
					)
				}
			/>
		</div>
	);
}

export function treeDirectoryLoaded(
	entries: BrowserTreeEntry[],
	path: string,
): boolean {
	const entry = findTreeDirectory(entries, path);
	return entry?.children !== undefined;
}

export function shouldLoadCodingRepositoryTree({
	activeTab,
	focusedWorkspaceKey,
}: {
	activeTab: CodingRightTab;
	focusedWorkspaceKey: string | undefined;
}): boolean {
	return activeTab === "files" && focusedWorkspaceKey !== undefined;
}

export function shouldLoadCodingRepositoryGitStatus({
	activeTab,
	focusedWorkspaceKey,
	gitRevision,
	loadedGitWorkspaceKey,
	loadedGitRevision,
}: {
	activeTab: CodingRightTab;
	focusedWorkspaceKey: string | undefined;
	gitRevision: number;
	loadedGitWorkspaceKey: string | null;
	loadedGitRevision: number | null;
}): boolean {
	if (activeTab !== "git" || focusedWorkspaceKey === undefined) {
		return false;
	}
	return (
		loadedGitWorkspaceKey !== focusedWorkspaceKey ||
		loadedGitRevision !== gitRevision
	);
}

export function shouldEnableCodingRunCommand({
	saving,
	workspaceKey,
}: {
	saving: boolean;
	workspaceKey: string | undefined;
}): boolean {
	return workspaceKey !== undefined && !saving;
}

export function shouldApplyCodingRepositoryDirectoryChildren({
	focusedWorkspaceKey,
	requestWorkspaceKey,
}: {
	focusedWorkspaceKey: string | undefined;
	requestWorkspaceKey: string;
}): boolean {
	return focusedWorkspaceKey === requestWorkspaceKey;
}

export interface CodingRightPanelWorkspaceTarget {
	providerId?: string;
	repositoryId: string;
	sdkSessionId?: string;
	workspaceCwd: string;
	workspaceKey: string;
}

export function resolveCodingRightPanelWorkspaceTarget({
	focusedRepositoryId,
	focusedSession,
	repository,
	repositorySessionsLoaded,
	sessions,
}: {
	focusedRepositoryId: string | undefined;
	focusedSession: { providerId: string; sdkSessionId: string } | undefined;
	repository: BrowserCodingRepositorySummary | undefined;
	repositorySessionsLoaded?: boolean;
	sessions: BrowserCodingSessionSummary[];
}): CodingRightPanelWorkspaceTarget | undefined {
	if (!focusedRepositoryId || !repository) {
		return undefined;
	}
	if (!focusedSession || isNonSessionCodingTab(focusedSession)) {
		return rootWorkspaceTarget(repository);
	}

	const session = sessions.find(
		(entry) =>
			entry.providerId === focusedSession.providerId &&
			entry.sdkSessionId === focusedSession.sdkSessionId &&
			(entry.repositoryId === undefined ||
				entry.repositoryId === focusedRepositoryId),
	);
	if (!session) {
		if (repositorySessionsLoaded && sessions.length === 0) {
			return rootWorkspaceTarget(repository);
		}
		return undefined;
	}

	return {
		providerId: session.providerId,
		repositoryId: focusedRepositoryId,
		sdkSessionId: session.sdkSessionId,
		workspaceCwd: session.cwd,
		workspaceKey: session.cwd,
	};
}

function isNonSessionCodingTab(tab: { providerId: string }): boolean {
	return (
		isPendingCodingTab(tab) || isCodingFileTab(tab) || isCodingDiffTab(tab)
	);
}

function rootWorkspaceTarget(
	repository: BrowserCodingRepositorySummary,
): CodingRightPanelWorkspaceTarget {
	return {
		repositoryId: repository.id,
		workspaceCwd: repository.rootCwd,
		workspaceKey: repository.rootCwd,
	};
}

function workspaceSessionParams(target: CodingRightPanelWorkspaceTarget): {
	providerId?: string;
	sdkSessionId?: string;
} {
	return target.providerId && target.sdkSessionId
		? {
				providerId: target.providerId,
				sdkSessionId: target.sdkSessionId,
			}
		: {};
}

export function mergeTreeDirectoryChildren(
	entries: BrowserTreeEntry[],
	path: string,
	children: BrowserTreeEntry[],
): BrowserTreeEntry[] {
	return entries.map((entry) => {
		if (entry.kind !== "directory") {
			return entry;
		}
		if (entry.path === path) {
			return { ...entry, children };
		}
		if (!entry.children) {
			return entry;
		}
		return {
			...entry,
			children: mergeTreeDirectoryChildren(entry.children, path, children),
		};
	});
}

function findTreeDirectory(
	entries: BrowserTreeEntry[],
	path: string,
): BrowserTreeEntry | undefined {
	for (const entry of entries) {
		if (entry.kind !== "directory") {
			continue;
		}
		if (entry.path === path) {
			return entry;
		}
		const nested = entry.children
			? findTreeDirectory(entry.children, path)
			: undefined;
		if (nested) {
			return nested;
		}
	}
	return undefined;
}
