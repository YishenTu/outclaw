import { existsSync, realpathSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { EffortLevel } from "../../common/commands.ts";
import type {
	BrowserAgentActiveSessionResponse,
	BrowserAgentsResponse,
	BrowserChatModelsResponse,
	BrowserCodingFolderPickerResponse,
	BrowserCodingModelsResponse,
	BrowserCodingRepositoryArchiveResponse,
	BrowserCodingRepositoryCloneResponse,
	BrowserCodingRepositoryDetail,
	BrowserCodingRepositoryListResponse,
	BrowserCodingRepositoryRestoreResponse,
	BrowserCodingRepositorySource,
	BrowserCodingRepositorySummary,
	BrowserCodingSessionArchiveResponse,
	BrowserCodingSessionCancelResponse,
	BrowserCodingSessionDeleteResponse,
	BrowserCodingSessionDetail,
	BrowserCodingSessionEvent,
	BrowserCodingSessionLifecycleStatus,
	BrowserCodingSessionLinksResponse,
	BrowserCodingSessionPageResponse,
	BrowserCodingSessionRestoreResponse,
	BrowserCodingSessionResumeResponse,
	BrowserCodingSessionStartResponse,
	BrowserCodingSessionStatusResponse,
	BrowserCodingSessionStopResponse,
	BrowserCodingSessionSummary,
	BrowserCodingSkillsResponse,
	BrowserConfigResponse,
	BrowserCronEntry,
	BrowserCronHistoryCursor,
	BrowserCronHistoryResponse,
	BrowserFileResponse,
	BrowserGitCommitResponse,
	BrowserGitCommitStats,
	BrowserGitDiffResponse,
	BrowserGitHistory,
	BrowserGitStatusResponse,
	BrowserGraphResponse,
	BrowserInboxArchiveResponse,
	BrowserInboxCreateNoteInput,
	BrowserInboxCreateNoteResponse,
	BrowserInboxResponse,
	BrowserInboxRestoreResponse,
	BrowserSessionPageResponse,
	BrowserTerminalRunCommandResponse,
	BrowserTreeEntry,
	CodingSessionEvent,
	ImageMediaType,
	ImageRef,
	ProviderModelInfo,
	ProviderSkillInfo,
	SessionCursor,
	TranscriptTurn,
	WorkspaceFileEntry,
} from "../../common/protocol.ts";
import type {
	ChatCodingLinkStore,
	CodingCloner,
	CodingRepositoryRecord,
	CodingRepositoryStore,
	CodingRuntime,
	CodingSessionDetail,
	CodingSessionEventRecorder,
	CodingSessionStore,
	StoredCodingSessionEvent,
} from "../coding/index.ts";
import {
	createGitCloner,
	openCodingSessionEventStream as openRuntimeCodingSessionEventStream,
} from "../coding/index.ts";
import {
	readStoredAgentConfig,
	writeStoredAgentConfig,
} from "../config/index.ts";
import { saveManagedImage } from "../files/managed-image-store.ts";
import { nextSessionCursor } from "../persistence/session-cursor.ts";
import type { SessionStore } from "../persistence/session-store/session-store.ts";
import {
	type BrowserApiAgent,
	listBrowserAgents,
	resolveVisibleActiveChatSession,
	toBrowserSessionSummary,
} from "./agent-sidebar/read-model.ts";
import {
	createNativeFolderPicker,
	type FolderPicker,
} from "./coding/folder-picker.ts";
import { BROWSER_CONFIG_SCHEMA } from "./config/schema.ts";
import { listCronRunsForJob } from "./cron/history.ts";
import { listCronEntries, setCronEnabled } from "./cron/workbench.ts";
import { buildAgentGraph } from "./files/build-graph.ts";
import {
	listRepositoryWorkspaceFiles,
	listWorkspaceFiles,
	REPOSITORY_WORKSPACE_IGNORED_NAMES,
} from "./files/list-workspace-files.ts";
import { readBrowserFile } from "./files/read-browser-file.ts";
import {
	listRepositoryTreeEntries,
	listTreeEntries,
} from "./files/tree-workbench.ts";
import { writeBrowserFile } from "./files/write-browser-file.ts";
import {
	initGitRepo as initGitRepoWorkbench,
	normalizeGitPaths,
	readAgentFileGitChange,
	readAgentTreeGitStatuses,
	readGitCommitStats as readGitCommitStatsWorkbench,
	readGitCommit as readGitCommitWorkbench,
	readGitDiff as readGitDiffWorkbench,
	readGitHistory as readGitHistoryWorkbench,
	readGitStatus as readGitStatusWorkbench,
} from "./git/workbench.ts";
import {
	archiveInboxItem,
	createInboxNote,
	listInboxEntries,
	restoreInboxItem,
} from "./inbox/workbench.ts";
import {
	resolveExistingPathWithinRoot,
	resolveWritablePathWithinRoot,
} from "./paths/path-safety.ts";

// The browser API only needs the start/resume/interrupt slice of the coding
// runtime, plus optional catalogs supplied by the surrounding CodingService.
// Accept the full CodingRuntime slice directly so production wiring and tests
// share one source of truth for method signatures.
export interface BrowserCodingService
	extends Pick<CodingRuntime, "startPrompt" | "resumePrompt" | "stopPrompt"> {
	cancelPrompt?: CodingRuntime["cancelPrompt"];
	archiveSession?(params: {
		providerId: string;
		sdkSessionId: string;
	}): Promise<void>;
	listModels?(): Promise<ProviderModelInfo[]>;
	listSkills?(params: {
		cwd: string;
		forceReload?: boolean;
	}): Promise<ProviderSkillInfo[]>;
	renameSession?(params: {
		providerId: string;
		sdkSessionId: string;
		title: string;
	}): Promise<void>;
	reconcileSessions?(params: {
		providerId: string;
		sdkSessionIds: string[];
	}): Promise<void>;
	rehydrateSessionEvents?(params: {
		providerId: string;
		sdkSessionId: string;
	}): Promise<CodingSessionEvent[]>;
	restoreSession?(params: {
		providerId: string;
		sdkSessionId: string;
	}): Promise<void>;
}

export interface BrowserChatProviderCatalog {
	displayName: string;
	listModels(): Promise<ProviderModelInfo[]>;
	providerId: string;
}

interface CreateBrowserApiOptions {
	agents: BrowserApiAgent[];
	chatCodingLinks?: ChatCodingLinkStore;
	chatProvidersByAgent?: Map<
		string,
		readonly BrowserChatProviderCatalog[] | undefined
	>;
	cloneCodingRepository?: CodingCloner;
	coding?: BrowserCodingService;
	codingEvents?: CodingSessionEventRecorder;
	codingRepositories?: CodingRepositoryStore;
	codingSessions?: CodingSessionStore;
	filesRoot?: string;
	pickCodingFolder?: FolderPicker;
	getBrowserClientAgentId?: (clientId: string) => string | undefined;
	getRememberedAgentId: () => string | undefined;
	gitRoot: string;
	homeDir: string;
	ignoredGitPaths?: readonly string[];
	readTranscriptsByAgent?: Map<
		string,
		| ((
				providerId: string,
				sessionId: string,
		  ) => Promise<TranscriptTurn[] | undefined>)
		| undefined
	>;
	storesByAgent: Map<string, SessionStore | undefined>;
}

export interface BrowserApi {
	getAgentActiveSession(agentId: string): BrowserAgentActiveSessionResponse;
	getAgentTerminalCwd(agentId: string): string | undefined;
	listAgentChatModels(agentId: string): Promise<BrowserChatModelsResponse>;
	listAgents(params?: { browserClientId?: string }): BrowserAgentsResponse;
	archiveAgentInboxItem(
		agentId: string,
		relativePath: string,
	): Promise<BrowserInboxArchiveResponse>;
	createAgentInboxNote(
		agentId: string,
		input: BrowserInboxCreateNoteInput,
	): Promise<BrowserInboxCreateNoteResponse>;
	listAgentCron(agentId: string): Promise<BrowserCronEntry[]>;
	listAgentCronHistory(
		agentId: string,
		params: {
			jobName: string;
			limit: number;
			before?: BrowserCronHistoryCursor;
		},
	): Promise<BrowserCronHistoryResponse>;
	listAgentInbox(agentId: string): Promise<BrowserInboxResponse>;
	listAgentSessions(
		agentId: string,
		params: {
			limit: number;
			cursor?: SessionCursor;
			query?: string;
		},
	): Promise<BrowserSessionPageResponse>;
	listChatCodingSessions(params: {
		agentId: string;
		providerId: string;
		sdkSessionId: string;
	}): Promise<BrowserCodingSessionLinksResponse>;
	linkChatCodingSession(params: {
		chatAgentId: string;
		chatProviderId: string;
		chatSdkSessionId: string;
		codingProviderId: string;
		codingSdkSessionId: string;
		timestamp?: number;
	}): void | Promise<void>;
	listCodingSessions(params: {
		limit: number;
		cursor?: SessionCursor;
		linkedChatSessionId?: string;
		lifecycleStatus?: BrowserCodingSessionLifecycleStatus;
		providerId?: string;
		query?: string;
		repositoryId?: string;
	}): Promise<BrowserCodingSessionPageResponse>;
	listCodingRepositories(params?: {
		includeArchived?: boolean;
	}): Promise<BrowserCodingRepositoryListResponse>;
	getCodingRepository(
		repositoryId: string,
	): Promise<BrowserCodingRepositoryDetail>;
	registerCodingRepository(params: {
		displayName?: string;
		remoteUrl?: string;
		rootCwd: string;
		source?: Extract<BrowserCodingRepositorySource, "manual" | "clone">;
	}): Promise<BrowserCodingRepositoryDetail>;
	cloneCodingRepository(params: {
		remoteUrl: string;
		parentDir: string;
		displayName?: string;
	}): Promise<BrowserCodingRepositoryCloneResponse>;
	archiveCodingRepository(
		repositoryId: string,
	): Promise<BrowserCodingRepositoryArchiveResponse>;
	restoreCodingRepository(
		repositoryId: string,
	): Promise<BrowserCodingRepositoryRestoreResponse>;
	pickCodingRepositoryFolder(): Promise<BrowserCodingFolderPickerResponse>;
	getCodingSession(
		providerId: string,
		sdkSessionId: string,
	): Promise<BrowserCodingSessionDetail>;
	getCodingSessionStatus(
		providerId: string,
		sdkSessionId: string,
	): Promise<BrowserCodingSessionStatusResponse>;
	archiveCodingSession(
		providerId: string,
		sdkSessionId: string,
	): Promise<BrowserCodingSessionArchiveResponse>;
	deleteCodingSession(
		providerId: string,
		sdkSessionId: string,
	): Promise<BrowserCodingSessionDeleteResponse>;
	restoreCodingSession(
		providerId: string,
		sdkSessionId: string,
	): Promise<BrowserCodingSessionRestoreResponse>;
	renameCodingSession(
		providerId: string,
		sdkSessionId: string,
		title: string,
	): Promise<BrowserCodingSessionDetail>;
	readCodingRepositoryFile(
		repositoryId: string,
		relativePath: string,
	): Promise<BrowserFileResponse>;
	writeCodingRepositoryFile(
		repositoryId: string,
		relativePath: string,
		content: string,
		expected: { mtimeMs: number; sha256: string },
	): Promise<BrowserFileResponse>;
	startCodingSession(params: {
		repositoryId?: string;
		cwd?: string;
		prompt: string;
		linkedChatSessionId?: string;
		model?: string;
		effort?: EffortLevel;
		serviceTier?: string;
	}): Promise<BrowserCodingSessionStartResponse>;
	resumeCodingSession(params: {
		providerId: string;
		sdkSessionId: string;
		prompt: string;
		model?: string;
		effort?: EffortLevel;
		serviceTier?: string;
	}): Promise<BrowserCodingSessionResumeResponse>;
	stopCodingSession(params: {
		providerId: string;
		sdkSessionId: string;
	}): Promise<BrowserCodingSessionStopResponse>;
	cancelCodingSession(params: {
		providerId: string;
		sdkSessionId: string;
	}): Promise<BrowserCodingSessionCancelResponse>;
	listCodingModels(): Promise<BrowserCodingModelsResponse>;
	listCodingRepositorySkills(
		repositoryId: string,
		params?: { forceReload?: boolean },
	): Promise<BrowserCodingSkillsResponse>;
	openCodingSessionEventStream(params: {
		providerId: string;
		sdkSessionId: string;
		follow?: boolean;
		sinceSequence?: number;
		signal?: AbortSignal;
	}): AsyncIterable<StoredCodingSessionEvent>;
	listAgentTree(agentId: string): Promise<BrowserTreeEntry[]>;
	listAgentGraph(agentId: string): Promise<BrowserGraphResponse>;
	listAgentWorkspaceFiles(agentId: string): Promise<WorkspaceFileEntry[]>;
	listCodingRepositoryWorkspaceFiles(
		repositoryId: string,
	): Promise<WorkspaceFileEntry[]>;
	listCodingRepositoryTree(
		repositoryId: string,
		params?: { path?: string; providerId?: string; sdkSessionId?: string },
	): Promise<BrowserTreeEntry[]>;
	getCodingRepositoryCwd(
		repositoryId: string,
		params?: { providerId?: string; sdkSessionId?: string },
	): string | undefined;
	readConfigFile(): Promise<BrowserConfigResponse>;
	writeConfigFile(
		document: Record<string, unknown>,
	): Promise<BrowserConfigResponse>;
	writeAgentTerminalRunCommand(
		agentId: string,
		command: string,
	): Promise<BrowserTerminalRunCommandResponse>;
	writeCodingRepositoryTerminalRunCommand(
		repositoryId: string,
		command: string,
	): Promise<BrowserTerminalRunCommandResponse>;
	readAgentFile(
		agentId: string,
		relativePath: string,
	): Promise<BrowserFileResponse>;
	writeAgentFile(
		agentId: string,
		relativePath: string,
		content: string,
		expected: { mtimeMs: number; sha256: string },
	): Promise<BrowserFileResponse>;
	initGitRepo(params?: {
		repositoryId?: string;
		providerId?: string;
		sdkSessionId?: string;
	}): Promise<BrowserGitStatusResponse>;
	readGitCommit(
		sha: string,
		params?: {
			repositoryId?: string;
			providerId?: string;
			sdkSessionId?: string;
		},
	): Promise<BrowserGitCommitResponse>;
	readGitCommitStats(
		sha: string,
		params?: {
			repositoryId?: string;
			providerId?: string;
			sdkSessionId?: string;
		},
	): Promise<BrowserGitCommitStats>;
	readGitDiff(
		path: string,
		params?: {
			repositoryId?: string;
			providerId?: string;
			sdkSessionId?: string;
		},
	): Promise<BrowserGitDiffResponse>;
	readGitHistory(params?: {
		repositoryId?: string;
		providerId?: string;
		sdkSessionId?: string;
		cursor?: string;
		limit?: number;
	}): Promise<BrowserGitHistory>;
	readGitStatus(params?: {
		repositoryId?: string;
		providerId?: string;
		sdkSessionId?: string;
	}): Promise<BrowserGitStatusResponse>;
	restoreAgentInboxItem(
		agentId: string,
		archivedPath: string,
		originalPath: string,
	): Promise<BrowserInboxRestoreResponse>;
	uploadImages(
		images: Array<{ bytes: Uint8Array; mediaType: ImageMediaType }>,
	): Promise<ImageRef[]>;
	setAgentCronEnabled(
		agentId: string,
		relativePath: string,
		enabled: boolean,
	): Promise<BrowserCronEntry>;
}

export function createBrowserApi(options: CreateBrowserApiOptions): BrowserApi {
	const agentsById = new Map<string, BrowserApiAgent>(
		options.agents.map((agent) => [agent.agentId, agent] as const),
	);
	const ignoredGitPaths = normalizeGitPaths(options.ignoredGitPaths ?? []);
	const repositoryIgnoredGitPaths = normalizeGitPaths([
		...REPOSITORY_WORKSPACE_IGNORED_NAMES,
	]);
	const pickCodingFolder =
		options.pickCodingFolder ?? createNativeFolderPicker();
	const cloneRepository = options.cloneCodingRepository ?? createGitCloner();

	function resolveRepositoryCwd(repositoryId: string): string {
		const repository = options.codingRepositories?.get(repositoryId);
		if (!repository) {
			throw new Error(`Unknown coding repository: ${repositoryId}`);
		}
		return repository.rootCwd;
	}

	function resolveCodingWorkspaceCwd(
		repositoryId: string,
		params?: { providerId?: string; sdkSessionId?: string },
	): { cwd: string; rootCwd: string } {
		const rootCwd = resolveRepositoryCwd(repositoryId);
		if (!params?.providerId && !params?.sdkSessionId) {
			return { cwd: rootCwd, rootCwd };
		}
		if (!params.providerId || !params.sdkSessionId) {
			throw new Error(
				"Coding session workspace requires provider and session id",
			);
		}
		const resolution = options.codingSessions?.resolveRef({
			providerId: params.providerId,
			sdkSessionId: params.sdkSessionId,
		});
		if (!resolution || resolution.status === "not_found") {
			throw new Error(
				`Unknown coding session: ${params.providerId}/${params.sdkSessionId}`,
			);
		}
		if (resolution.status === "ambiguous") {
			throw new Error(`Ambiguous coding session: ${params.sdkSessionId}`);
		}
		const session = resolution.session;
		if (session.repositoryId && session.repositoryId !== repositoryId) {
			throw new Error(
				`Coding session does not belong to repository: ${repositoryId}`,
			);
		}
		const sessionCwd = canonicalizeForCompare(session.cwd);
		if (!isPathWithin(rootCwd, sessionCwd)) {
			throw new Error(
				`Coding session cwd must be within repository root: ${rootCwd}`,
			);
		}
		return { cwd: sessionCwd, rootCwd };
	}

	function resolveGitWorkspace(params?: {
		repositoryId?: string;
		providerId?: string;
		sdkSessionId?: string;
	}): { cwd: string; rootCwd: string } {
		if (params?.repositoryId) {
			return resolveCodingWorkspaceCwd(params.repositoryId, params);
		}
		return { cwd: options.gitRoot, rootCwd: options.gitRoot };
	}

	function resolveGitIgnoredPaths(params?: {
		repositoryId?: string;
	}): readonly string[] {
		return params?.repositoryId ? repositoryIgnoredGitPaths : ignoredGitPaths;
	}

	return {
		getAgentTerminalCwd(agentId) {
			return agentsById.get(agentId)?.homeDir;
		},
		getCodingRepositoryCwd(repositoryId, params) {
			if (!options.codingRepositories?.get(repositoryId)) {
				return undefined;
			}
			return resolveCodingWorkspaceCwd(repositoryId, params).cwd;
		},
		listAgents(params) {
			return listBrowserAgents({
				activeAgentId: resolveBrowserActiveAgentId({
					agentsById,
					browserClientId: params?.browserClientId,
					getBrowserClientAgentId: options.getBrowserClientAgentId,
					getRememberedAgentId: options.getRememberedAgentId,
				}),
				agents: agentsById.values(),
				storesByAgent: options.storesByAgent,
			});
		},
		getAgentActiveSession(agentId) {
			const agent = requireAgent(agentsById, agentId);
			const store = options.storesByAgent.get(agentId);
			const activeSession = resolveVisibleActiveChatSession(agent, store);
			const blankSelection = store?.getBlankChatModelSelection();
			return {
				...(activeSession ? { activeSession } : {}),
				...(blankSelection ? { blankSelection } : {}),
			};
		},
		async listAgentChatModels(agentId) {
			requireAgent(agentsById, agentId);
			const providers =
				options.chatProvidersByAgent?.get(agentId) ??
				options.chatProvidersByAgent?.get("*") ??
				[];
			const models = (
				await Promise.all(
					providers.map(async (provider) => {
						const providerModels = await provider.listModels();
						return providerModels.map((model) => ({
							providerId: provider.providerId,
							providerDisplayName: provider.displayName,
							model: model.model,
							displayName: model.displayName,
							description: model.description,
							isDefault: model.isDefault,
							defaultReasoningEffort: model.defaultReasoningEffort,
							supportedReasoningEfforts: model.supportedReasoningEfforts,
							serviceTiers: model.serviceTiers,
						}));
					}),
				)
			).flat();
			return { models };
		},
		async listAgentCron(agentId) {
			const agent = requireAgent(agentsById, agentId);
			return await listCronEntries(agent.homeDir);
		},
		async listAgentCronHistory(agentId, params) {
			requireAgent(agentsById, agentId);
			const store = options.storesByAgent.get(agentId);
			if (!store) {
				return { entries: [], hasMore: false };
			}
			const readTranscript = options.readTranscriptsByAgent?.get(agentId);
			return listCronRunsForJob(store, params.jobName, {
				limit: params.limit,
				before: params.before,
				readTranscript: readTranscript
					? (providerId, sessionId) => readTranscript(providerId, sessionId)
					: undefined,
			});
		},
		async listAgentInbox(agentId) {
			const agent = requireAgent(agentsById, agentId);
			return await listInboxEntries(agent.homeDir);
		},
		async listAgentSessions(agentId, params) {
			requireAgent(agentsById, agentId);
			const store = options.storesByAgent.get(agentId);
			if (!store) {
				return { sessions: [] };
			}
			const query = params.query?.trim();
			const listOptions = {
				cursor: params.cursor,
				limit: params.limit,
				tag: "chat" as const,
			};
			const rows = query
				? store.searchByTitle({ ...listOptions, query })
				: store.list(listOptions);
			return {
				query: query || undefined,
				sessions: rows.map(toBrowserSessionSummary),
				nextCursor: nextSessionCursor(rows, params.limit),
			};
		},
		async listChatCodingSessions(params) {
			requireAgent(agentsById, params.agentId);
			const chatSession = options.storesByAgent
				.get(params.agentId)
				?.get(params.providerId, params.sdkSessionId);
			if (!chatSession || chatSession.tag !== "chat") {
				return { sessions: [] };
			}
			const linkedSessions =
				options.chatCodingLinks?.listForChat({
					chatAgentId: params.agentId,
					chatProviderId: params.providerId,
					chatSdkSessionId: params.sdkSessionId,
				}) ?? [];
			await reconcileKnownCodingSessionRefs(options, linkedSessions);
			return {
				sessions:
					options.chatCodingLinks
						?.listForChat({
							chatAgentId: params.agentId,
							chatProviderId: params.providerId,
							chatSdkSessionId: params.sdkSessionId,
						})
						.map(toBrowserCodingSessionSummary) ?? [],
			};
		},
		linkChatCodingSession(params) {
			options.chatCodingLinks?.upsert(params);
		},
		async listCodingSessions(params) {
			const store = options.codingSessions;
			if (!store) {
				return { sessions: [] };
			}
			await reconcileKnownCodingSessions(options, {
				linkedChatSessionId: params.linkedChatSessionId,
				providerId: params.providerId,
				repositoryId: params.repositoryId,
			});
			const query = params.query?.trim();
			const result = store.list({
				cursor: params.cursor,
				linkedChatSessionId: params.linkedChatSessionId,
				limit: params.limit,
				lifecycleStatus: params.lifecycleStatus,
				providerId: params.providerId,
				...(query ? { query } : {}),
				repositoryId: params.repositoryId,
			});
			return {
				...(query ? { query } : {}),
				sessions: result.sessions.map(toBrowserCodingSessionSummary),
				nextCursor: result.nextCursor,
			};
		},
		async listCodingRepositories(params) {
			if (!options.codingRepositories) {
				return { repositories: [] };
			}
			return {
				repositories: options.codingRepositories
					.list({ includeArchived: params?.includeArchived })
					.map(toBrowserCodingRepositorySummary),
			};
		},
		async getCodingRepository(repositoryId) {
			const repository = options.codingRepositories?.get(repositoryId);
			if (!repository) {
				throw new Error(`Unknown coding repository: ${repositoryId}`);
			}
			return toBrowserCodingRepositorySummary(repository);
		},
		async registerCodingRepository(params) {
			if (!options.codingRepositories) {
				throw new Error("Coding repository API is not configured");
			}
			return toBrowserCodingRepositorySummary(
				options.codingRepositories.register({
					displayName: params.displayName,
					remoteUrl: params.remoteUrl,
					rootCwd: params.rootCwd,
					source: params.source ?? "manual",
				}),
			);
		},
		async cloneCodingRepository(params) {
			if (!options.codingRepositories) {
				throw new Error("Coding repository API is not configured");
			}
			const result = await cloneRepository({
				remoteUrl: params.remoteUrl,
				parentDir: params.parentDir,
				...(params.displayName !== undefined
					? { displayName: params.displayName }
					: {}),
			});
			if (result.status === "failed") {
				return { status: "failed", message: result.message };
			}
			return {
				status: "cloned",
				repository: toBrowserCodingRepositorySummary(
					options.codingRepositories.register({
						displayName: params.displayName ?? result.displayName,
						remoteUrl: params.remoteUrl,
						rootCwd: result.rootCwd,
						source: "clone",
					}),
				),
			};
		},
		async pickCodingRepositoryFolder() {
			return await pickCodingFolder();
		},
		async archiveCodingRepository(repositoryId) {
			if (!options.codingRepositories) {
				throw new Error("Coding repository API is not configured");
			}
			options.codingRepositories.archive(repositoryId);
			const repository = options.codingRepositories.get(repositoryId);
			if (!repository) {
				throw new Error(`Unknown coding repository: ${repositoryId}`);
			}
			return {
				archived: true,
				repository: toBrowserCodingRepositorySummary(repository),
			};
		},
		async restoreCodingRepository(repositoryId) {
			if (!options.codingRepositories) {
				throw new Error("Coding repository API is not configured");
			}
			options.codingRepositories.restore(repositoryId);
			const repository = options.codingRepositories.get(repositoryId);
			if (!repository) {
				throw new Error(`Unknown coding repository: ${repositoryId}`);
			}
			return {
				restored: true,
				repository: toBrowserCodingRepositorySummary(repository),
			};
		},
		async writeCodingRepositoryTerminalRunCommand(repositoryId, command) {
			if (!options.codingRepositories) {
				throw new Error("Coding repository API is not configured");
			}
			const nextCommand = normalizeTerminalRunCommand(command);
			const repository = options.codingRepositories.writeTerminalRunCommand(
				repositoryId,
				nextCommand,
			);
			return {
				command: repository.terminalRunCommand,
			};
		},
		async getCodingSession(providerId, sdkSessionId) {
			await reconcileKnownCodingSessions(options, {
				providerId,
				sdkSessionIds: [sdkSessionId],
			});
			const session = options.codingSessions?.getDetail(
				providerId,
				sdkSessionId,
			);
			if (!session) {
				throw new Error(
					`Unknown coding session: ${providerId}/${sdkSessionId}`,
				);
			}
			const events = await readCodingSessionBootstrapEvents(options, {
				providerId,
				sdkSessionId,
			});
			return {
				...toBrowserCodingSessionSummary(session),
				...(events.length > 0 ? { events } : {}),
			};
		},
		async getCodingSessionStatus(providerId, sdkSessionId) {
			await reconcileKnownCodingSessions(options, {
				providerId,
				sdkSessionIds: [sdkSessionId],
			});
			const session = options.codingSessions?.getDetail(
				providerId,
				sdkSessionId,
			);
			if (!session) {
				throw new Error(
					`Unknown coding session: ${providerId}/${sdkSessionId}`,
				);
			}
			const base = toBrowserCodingSessionStatusBase(session, options);
			if (session.runStatus === "running") {
				return {
					...base,
					providerId,
					sdkSessionId,
					state: "running",
				};
			}
			if (session.runStatus === "failed") {
				return {
					...base,
					providerId,
					sdkSessionId,
					state: "error",
					error: {
						message: session.failureMessage ?? "Coding session failed",
					},
				};
			}
			if (session.runStatus === "cancelled") {
				return {
					...base,
					providerId,
					sdkSessionId,
					state: "cancelled",
				};
			}
			const events = (
				await readCodingSessionBootstrapEvents(options, {
					providerId,
					sdkSessionId,
				})
			).map((item) => item.event);
			return {
				...base,
				providerId,
				sdkSessionId,
				state: "done",
				...lastCodingPromptField(events),
				finalResponse: extractLatestAssistantResponse(events),
			};
		},
		async archiveCodingSession(providerId, sdkSessionId) {
			const store = options.codingSessions;
			if (!store) {
				throw new Error(
					`Unknown coding session: ${providerId}/${sdkSessionId}`,
				);
			}
			const session = store.getDetail(providerId, sdkSessionId);
			if (!session) {
				throw new Error(
					`Unknown coding session: ${providerId}/${sdkSessionId}`,
				);
			}
			await options.coding?.archiveSession?.({ providerId, sdkSessionId });
			store.archive(providerId, sdkSessionId);
			const archived = store.getDetail(providerId, sdkSessionId);
			if (!archived) {
				throw new Error(
					`Unknown coding session: ${providerId}/${sdkSessionId}`,
				);
			}
			return {
				archived: true,
				session: toBrowserCodingSessionSummary(archived),
			};
		},
		async deleteCodingSession(providerId, sdkSessionId) {
			const store = options.codingSessions;
			if (!store) {
				throw new Error(
					`Unknown coding session: ${providerId}/${sdkSessionId}`,
				);
			}
			const session = store.getDetail(providerId, sdkSessionId);
			if (!session) {
				throw new Error(
					`Unknown coding session: ${providerId}/${sdkSessionId}`,
				);
			}
			store.delete(providerId, sdkSessionId);
			return {
				deleted: true,
				providerId,
				sdkSessionId,
			};
		},
		async restoreCodingSession(providerId, sdkSessionId) {
			const store = options.codingSessions;
			if (!store) {
				throw new Error(
					`Unknown coding session: ${providerId}/${sdkSessionId}`,
				);
			}
			const session = store.getDetail(providerId, sdkSessionId);
			if (!session) {
				throw new Error(
					`Unknown coding session: ${providerId}/${sdkSessionId}`,
				);
			}
			await options.coding?.restoreSession?.({ providerId, sdkSessionId });
			store.restore(providerId, sdkSessionId);
			const restored = store.getDetail(providerId, sdkSessionId);
			if (!restored) {
				throw new Error(
					`Unknown coding session: ${providerId}/${sdkSessionId}`,
				);
			}
			return {
				restored: true,
				session: toBrowserCodingSessionSummary(restored),
			};
		},
		async renameCodingSession(providerId, sdkSessionId, title) {
			const store = options.codingSessions;
			if (!store) {
				throw new Error(
					`Unknown coding session: ${providerId}/${sdkSessionId}`,
				);
			}
			const trimmed = title.trim();
			if (trimmed === "") {
				throw new Error("Coding session title cannot be empty");
			}
			const session = store.getDetail(providerId, sdkSessionId);
			if (!session) {
				throw new Error(
					`Unknown coding session: ${providerId}/${sdkSessionId}`,
				);
			}
			await options.coding?.renameSession?.({
				providerId,
				sdkSessionId,
				title: trimmed,
			});
			store.rename(providerId, sdkSessionId, trimmed);
			const renamed = store.getDetail(providerId, sdkSessionId);
			if (!renamed) {
				throw new Error(
					`Unknown coding session: ${providerId}/${sdkSessionId}`,
				);
			}
			return toBrowserCodingSessionSummary(renamed);
		},
		async startCodingSession(params) {
			const coding = options.coding;
			if (!coding) {
				return {
					status: "rejected",
					message: "Coding service is not configured",
				};
			}
			const prompt = params.prompt?.trim();
			if (!prompt) {
				return {
					status: "rejected",
					message: "Coding session start requires a prompt",
				};
			}
			let cwd: string | undefined = params.cwd;
			if (params.repositoryId) {
				const repository = options.codingRepositories?.get(params.repositoryId);
				if (!repository) {
					return {
						status: "rejected",
						message: `Unknown coding repository: ${params.repositoryId}`,
					};
				}
				if (params.cwd && !isPathWithin(repository.rootCwd, params.cwd)) {
					return {
						status: "rejected",
						message: `Coding session cwd must be within repository root: ${repository.rootCwd}`,
					};
				}
				cwd = cwd ?? repository.rootCwd;
			}
			if (!cwd) {
				return {
					status: "rejected",
					message:
						"Coding session start requires either a repository id or an explicit cwd",
				};
			}
			return coding.startPrompt({
				cwd,
				...(params.linkedChatSessionId
					? { linkedChatSessionId: params.linkedChatSessionId }
					: {}),
				prompt,
				...(params.model ? { model: params.model } : {}),
				...(params.effort ? { effort: params.effort } : {}),
				...(params.serviceTier ? { serviceTier: params.serviceTier } : {}),
			});
		},
		openCodingSessionEventStream(params) {
			if (!options.coding && !options.codingEvents) {
				return emptyAsyncIterable();
			}
			return openRuntimeCodingSessionEventStream({
				history: options.coding?.rehydrateSessionEvents
					? {
							readCodingSessionEvents: (target) =>
								options.coding?.rehydrateSessionEvents?.(target) ??
								Promise.resolve([]),
						}
					: undefined,
				liveEvents: options.codingEvents,
				sessions: options.codingSessions
					? {
							hasCodingSession: (target) =>
								!!options.codingSessions?.getDetail(
									target.providerId,
									target.sdkSessionId,
								),
						}
					: undefined,
				...params,
				follow: params.follow ?? true,
			});
		},
		async resumeCodingSession(params) {
			const coding = options.coding;
			if (!coding) {
				return {
					status: "rejected",
					message: "Coding service is not configured",
				};
			}
			const prompt = params.prompt?.trim();
			if (!prompt) {
				return {
					status: "rejected",
					message: "Coding session resume requires a prompt",
				};
			}
			await reconcileKnownCodingSessions(options, {
				providerId: params.providerId,
				sdkSessionIds: [params.sdkSessionId],
			});
			const session = options.codingSessions?.get(
				params.providerId,
				params.sdkSessionId,
			);
			if (session?.lifecycleStatus === "archived") {
				await options.coding?.restoreSession?.({
					providerId: params.providerId,
					sdkSessionId: params.sdkSessionId,
				});
				options.codingSessions?.restore(params.providerId, params.sdkSessionId);
			}
			return coding.resumePrompt({
				providerId: params.providerId,
				sdkSessionId: params.sdkSessionId,
				prompt,
				...(params.model ? { model: params.model } : {}),
				...(params.effort ? { effort: params.effort } : {}),
				...(params.serviceTier ? { serviceTier: params.serviceTier } : {}),
			});
		},
		async stopCodingSession(params) {
			const coding = options.coding;
			if (!coding) {
				return {
					status: "rejected",
					message: "Coding service is not configured",
				};
			}
			if (coding.cancelPrompt) {
				const result = coding.cancelPrompt({
					providerId: params.providerId,
					sdkSessionId: params.sdkSessionId,
				});
				if (result.status === "rejected") {
					return result;
				}
				return {
					status: "accepted",
					providerId: result.providerId,
					sdkSessionId: result.sdkSessionId,
				};
			}
			return coding.stopPrompt({
				providerId: params.providerId,
				sdkSessionId: params.sdkSessionId,
			});
		},
		async cancelCodingSession(params) {
			const coding = options.coding;
			if (!coding?.cancelPrompt) {
				return {
					status: "rejected",
					message: "Coding service is not configured",
				};
			}
			return coding.cancelPrompt({
				providerId: params.providerId,
				sdkSessionId: params.sdkSessionId,
			});
		},
		async listCodingModels() {
			const coding = options.coding;
			if (!coding?.listModels) {
				return { models: [] };
			}
			const models = await coding.listModels();
			return { models };
		},
		async listCodingRepositorySkills(repositoryId, params) {
			const repository = options.codingRepositories?.get(repositoryId);
			if (!repository) {
				throw new Error(`Unknown coding repository: ${repositoryId}`);
			}
			if (!options.coding?.listSkills) {
				throw new Error("Coding skill catalog is not configured");
			}
			const skills = await options.coding.listSkills({
				cwd: repository.rootCwd,
				...(params?.forceReload ? { forceReload: true } : {}),
			});
			return { skills };
		},
		async archiveAgentInboxItem(agentId, relativePath) {
			const agent = requireAgent(agentsById, agentId);
			return await archiveInboxItem(agent.homeDir, relativePath);
		},
		async createAgentInboxNote(agentId, input) {
			const agent = requireAgent(agentsById, agentId);
			return await createInboxNote(agent.homeDir, input);
		},
		async restoreAgentInboxItem(agentId, archivedPath, originalPath) {
			const agent = requireAgent(agentsById, agentId);
			return await restoreInboxItem(agent.homeDir, archivedPath, originalPath);
		},
		async setAgentCronEnabled(agentId, relativePath, enabled) {
			const agent = requireAgent(agentsById, agentId);
			return await setCronEnabled(agent.homeDir, relativePath, enabled);
		},
		async listAgentTree(agentId) {
			const agent = requireAgent(agentsById, agentId);
			const gitStatuses = readAgentTreeGitStatuses(
				options.gitRoot,
				agent.homeDir,
				ignoredGitPaths,
			);
			return await listTreeEntries(agent.homeDir, agent.homeDir, gitStatuses);
		},
		async listAgentWorkspaceFiles(agentId) {
			const agent = requireAgent(agentsById, agentId);
			return await listWorkspaceFiles(agent.homeDir);
		},
		async listCodingRepositoryWorkspaceFiles(repositoryId) {
			return await listRepositoryWorkspaceFiles(
				resolveRepositoryCwd(repositoryId),
			);
		},
		async listAgentGraph(agentId) {
			const agent = requireAgent(agentsById, agentId);
			return await buildAgentGraph(agent.homeDir);
		},
		async readConfigFile() {
			const absolutePath = resolveExistingPathWithinRoot(
				options.homeDir,
				"config.json",
			);
			return {
				...(await readBrowserFile(options.homeDir, absolutePath)),
				schema: BROWSER_CONFIG_SCHEMA,
			};
		},
		async writeConfigFile(document) {
			if (!isPlainObject(document)) {
				throw new Error("Config document must be a JSON object");
			}
			const absolutePath = resolveWritablePathWithinRoot(
				options.homeDir,
				"config.json",
			);
			await writeFile(
				absolutePath,
				`${JSON.stringify(document, null, "\t")}\n`,
				"utf8",
			);
			return {
				...(await readBrowserFile(options.homeDir, absolutePath)),
				schema: BROWSER_CONFIG_SCHEMA,
			};
		},
		async writeAgentTerminalRunCommand(agentId, command) {
			const agent = requireAgent(agentsById, agentId);
			const nextCommand = normalizeTerminalRunCommand(command);
			const stored = readStoredAgentConfig(options.homeDir, agentId);
			writeStoredAgentConfig(options.homeDir, agentId, {
				...stored,
				terminal: {
					...(stored.terminal ?? {}),
					runCommand: nextCommand,
				},
			});
			return {
				command: agent.terminalRunCommand,
			};
		},
		async readAgentFile(agentId, relativePath) {
			const agent = requireAgent(agentsById, agentId);
			const absolutePath = resolveExistingPathWithinRoot(
				agent.homeDir,
				relativePath,
			);
			const file = await readBrowserFile(agent.homeDir, absolutePath);
			const gitChange = readAgentFileGitChange(
				options.gitRoot,
				agent.homeDir,
				file.path,
				ignoredGitPaths,
			);
			return {
				...file,
				...(gitChange ? { gitChange } : {}),
			};
		},
		async readCodingRepositoryFile(repositoryId, relativePath) {
			const cwd = resolveRepositoryCwd(repositoryId);
			const absolutePath = resolveExistingPathWithinRoot(cwd, relativePath);
			const file = await readBrowserFile(cwd, absolutePath);
			const gitChange = readAgentFileGitChange(
				cwd,
				cwd,
				file.path,
				repositoryIgnoredGitPaths,
			);
			return {
				...file,
				...(gitChange ? { gitChange } : {}),
			};
		},
		async writeCodingRepositoryFile(
			repositoryId,
			relativePath,
			content,
			expected,
		) {
			const cwd = resolveRepositoryCwd(repositoryId);
			const absolutePath = resolveExistingPathWithinRoot(cwd, relativePath);
			const file = await writeBrowserFile(cwd, absolutePath, content, expected);
			const gitChange = readAgentFileGitChange(
				cwd,
				cwd,
				file.path,
				repositoryIgnoredGitPaths,
			);
			return {
				...file,
				...(gitChange ? { gitChange } : {}),
			};
		},
		async writeAgentFile(agentId, relativePath, content, expected) {
			const agent = requireAgent(agentsById, agentId);
			const absolutePath = resolveExistingPathWithinRoot(
				agent.homeDir,
				relativePath,
			);
			const file = await writeBrowserFile(
				agent.homeDir,
				absolutePath,
				content,
				expected,
			);
			const gitChange = readAgentFileGitChange(
				options.gitRoot,
				agent.homeDir,
				file.path,
				ignoredGitPaths,
			);
			return {
				...file,
				...(gitChange ? { gitChange } : {}),
			};
		},
		async readGitStatus(params) {
			const workspace = resolveGitWorkspace(params);
			return readGitStatusWorkbench(
				workspace.cwd,
				resolveGitIgnoredPaths(params),
				{ rootCwd: workspace.rootCwd },
			);
		},
		async initGitRepo(params) {
			const workspace = resolveGitWorkspace(params);
			return initGitRepoWorkbench(
				workspace.cwd,
				resolveGitIgnoredPaths(params),
				{ rootCwd: workspace.rootCwd },
			);
		},
		async readGitCommit(sha, params) {
			const workspace = resolveGitWorkspace(params);
			return readGitCommitWorkbench(workspace.cwd, sha, {
				rootCwd: workspace.rootCwd,
			});
		},
		async readGitCommitStats(sha, params) {
			const workspace = resolveGitWorkspace(params);
			return readGitCommitStatsWorkbench(workspace.cwd, sha, {
				rootCwd: workspace.rootCwd,
			});
		},
		async readGitDiff(path, params) {
			const workspace = resolveGitWorkspace(params);
			return readGitDiffWorkbench(workspace.cwd, path, {
				rootCwd: workspace.rootCwd,
			});
		},
		async readGitHistory(params) {
			const workspace = resolveGitWorkspace(params);
			return readGitHistoryWorkbench(workspace.cwd, {
				cursor: params?.cursor,
				limit: params?.limit,
				rootCwd: workspace.rootCwd,
			});
		},
		async listCodingRepositoryTree(repositoryId, params) {
			const workspace = resolveCodingWorkspaceCwd(repositoryId, params);
			const currentDir = params?.path
				? resolveExistingPathWithinRoot(workspace.rootCwd, params.path)
				: workspace.cwd;
			if (!isPathWithin(workspace.cwd, currentDir)) {
				throw new Error("Path escapes coding session cwd");
			}
			const gitStatuses = readAgentTreeGitStatuses(
				workspace.rootCwd,
				workspace.rootCwd,
				repositoryIgnoredGitPaths,
			);
			return await listRepositoryTreeEntries(
				workspace.rootCwd,
				currentDir,
				gitStatuses,
				{
					maxDepth: 1,
				},
			);
		},
		async uploadImages(images) {
			if (!options.filesRoot) {
				throw new Error("Browser files root is not configured");
			}

			return await Promise.all(
				images.map((image) =>
					saveManagedImage(
						options.filesRoot as string,
						image.mediaType,
						image.bytes,
					),
				),
			);
		},
	};
}

async function reconcileKnownCodingSessions(
	options: Pick<CreateBrowserApiOptions, "coding" | "codingSessions">,
	params: {
		linkedChatSessionId?: string;
		providerId?: string;
		repositoryId?: string;
		sdkSessionIds?: string[];
	} = {},
): Promise<void> {
	if (!options.coding?.reconcileSessions || !options.codingSessions) {
		return;
	}
	const refs =
		params.providerId && params.sdkSessionIds
			? params.sdkSessionIds
					.filter((sdkSessionId) =>
						options.codingSessions?.get(params.providerId ?? "", sdkSessionId),
					)
					.map((sdkSessionId) => ({
						providerId: params.providerId ?? "",
						sdkSessionId,
					}))
			: options.codingSessions.listRefs({
					...(params.linkedChatSessionId
						? { linkedChatSessionId: params.linkedChatSessionId }
						: {}),
					...(params.providerId ? { providerId: params.providerId } : {}),
					...(params.repositoryId ? { repositoryId: params.repositoryId } : {}),
				});
	await reconcileKnownCodingSessionRefs(options, refs);
}

async function reconcileKnownCodingSessionRefs(
	options: Pick<CreateBrowserApiOptions, "coding">,
	refs: Array<{ providerId: string; sdkSessionId: string }>,
): Promise<void> {
	const idsByProvider = new Map<string, string[]>();
	for (const ref of refs) {
		const current = idsByProvider.get(ref.providerId) ?? [];
		if (!current.includes(ref.sdkSessionId)) {
			current.push(ref.sdkSessionId);
		}
		idsByProvider.set(ref.providerId, current);
	}
	for (const [providerId, sdkSessionIds] of idsByProvider) {
		try {
			await options.coding?.reconcileSessions?.({ providerId, sdkSessionIds });
		} catch {
			// Reconciliation is a freshness pass; local catalog reads should still work
			// when the provider is temporarily unavailable.
		}
	}
}

function normalizeTerminalRunCommand(command: string): string {
	const nextCommand = command.trim();
	if (nextCommand.includes("\n") || nextCommand.includes("\r")) {
		throw new Error("Terminal run command must be a single line");
	}
	return nextCommand;
}

async function readCodingSessionBootstrapEvents(
	options: Pick<
		CreateBrowserApiOptions,
		"coding" | "codingEvents" | "codingSessions"
	>,
	target: { providerId: string; sdkSessionId: string },
): Promise<BrowserCodingSessionEvent[]> {
	const events: BrowserCodingSessionEvent[] = [];
	for await (const item of openRuntimeCodingSessionEventStream({
		history: options.coding?.rehydrateSessionEvents
			? {
					readCodingSessionEvents: (params) =>
						options.coding?.rehydrateSessionEvents?.(params) ??
						Promise.resolve([]),
				}
			: undefined,
		liveEvents: options.codingEvents,
		sessions: options.codingSessions
			? {
					hasCodingSession: (params) =>
						!!options.codingSessions?.getDetail(
							params.providerId,
							params.sdkSessionId,
						),
				}
			: undefined,
		...target,
		follow: false,
	})) {
		events.push(item);
	}
	return events;
}

function extractLatestAssistantResponse(events: CodingSessionEvent[]): string {
	let response = "";
	for (const event of events) {
		if (event.type === "user_prompt") {
			response = "";
			continue;
		}
		if (event.type === "text") {
			response += event.text;
		}
	}
	return response.trim();
}

function lastCodingPromptField(events: CodingSessionEvent[]): {
	lastPrompt?: string;
} {
	let lastPrompt: string | undefined;
	for (const event of events) {
		if (event.type === "user_prompt") {
			lastPrompt = event.text;
		}
	}
	return lastPrompt ? { lastPrompt } : {};
}

function toBrowserCodingSessionStatusBase(
	session: CodingSessionDetail,
	options: Pick<CreateBrowserApiOptions, "codingRepositories">,
): {
	ref: string;
	repo: string;
	startedAt: string;
	lastEventAt: string;
	durationMs: number;
} {
	const repositoryRoot = session.repositoryId
		? options.codingRepositories?.get(session.repositoryId)?.rootCwd
		: undefined;
	return {
		ref: `${session.providerId}/${session.sdkSessionId}`,
		repo: repositoryRoot ?? session.cwd,
		startedAt: new Date(session.createdAt).toISOString(),
		lastEventAt: new Date(session.lastActive).toISOString(),
		durationMs: Math.max(0, session.lastActive - session.createdAt),
	};
}

function toBrowserCodingSessionSummary(
	session: CodingSessionDetail,
): BrowserCodingSessionSummary {
	return {
		providerId: session.providerId,
		sdkSessionId: session.sdkSessionId,
		...(session.repositoryId ? { repositoryId: session.repositoryId } : {}),
		title: session.title,
		model: session.model,
		lastActive: session.lastActive,
		cwd: session.cwd,
		lifecycleStatus: session.lifecycleStatus,
		runStatus: session.runStatus,
		createdAt: session.createdAt,
		source: session.source,
		tag: session.tag,
		...(session.ocSessionId ? { ocSessionId: session.ocSessionId } : {}),
		...(session.linkedChatSessionId
			? { linkedChatSessionId: session.linkedChatSessionId }
			: {}),
		...(session.browserTabId ? { browserTabId: session.browserTabId } : {}),
		...(session.failedAt ? { failedAt: session.failedAt } : {}),
		...(session.failureMessage
			? { failureMessage: session.failureMessage }
			: {}),
	};
}

function toBrowserCodingRepositorySummary(
	repository: CodingRepositoryRecord,
): BrowserCodingRepositorySummary {
	return {
		id: repository.id,
		rootCwd: repository.rootCwd,
		displayName: repository.displayName,
		...(repository.remoteUrl ? { remoteUrl: repository.remoteUrl } : {}),
		source: repository.source,
		status: repository.status,
		...(repository.terminalRunCommand
			? { terminalRunCommand: repository.terminalRunCommand }
			: {}),
		createdAt: repository.createdAt,
		lastActive: repository.lastActive,
		...(repository.archivedAt ? { archivedAt: repository.archivedAt } : {}),
	};
}

function requireAgent(
	agentsById: Map<string, BrowserApiAgent>,
	agentId: string,
): BrowserApiAgent {
	const agent = agentsById.get(agentId);
	if (!agent) {
		throw new Error(`Unknown agent: ${agentId}`);
	}
	return agent;
}

function resolveBrowserActiveAgentId(params: {
	agentsById: Map<string, BrowserApiAgent>;
	browserClientId?: string;
	getBrowserClientAgentId?: (clientId: string) => string | undefined;
	getRememberedAgentId: () => string | undefined;
}): string | undefined {
	if (params.getBrowserClientAgentId) {
		const cookieAgentId = params.browserClientId
			? params.getBrowserClientAgentId(params.browserClientId)
			: undefined;
		if (cookieAgentId && params.agentsById.has(cookieAgentId)) {
			return cookieAgentId;
		}

		return params.agentsById.keys().next().value;
	}

	return params.getRememberedAgentId();
}

function isPathWithin(root: string, candidate: string): boolean {
	const absoluteRoot = canonicalizeForCompare(root);
	const absoluteCandidate = canonicalizeForCompare(candidate);
	if (absoluteCandidate === absoluteRoot) {
		return true;
	}
	const rel = relative(absoluteRoot, absoluteCandidate);
	return rel !== "" && !rel.startsWith("..");
}

function canonicalizeForCompare(path: string): string {
	const absolute = resolve(path);
	return existsSync(absolute) ? realpathSync(absolute) : absolute;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// biome-ignore lint/correctness/useYield: intentionally yields nothing
async function* emptyAsyncIterable<T>(): AsyncIterable<T> {
	return;
}
