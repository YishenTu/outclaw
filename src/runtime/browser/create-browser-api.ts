import { existsSync, realpathSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { EffortLevel } from "../../common/commands.ts";
import type {
	BrowserAgentsResponse,
	BrowserCodingFolderPickerResponse,
	BrowserCodingModelsResponse,
	BrowserCodingRepositoryArchiveResponse,
	BrowserCodingRepositoryDetail,
	BrowserCodingRepositoryListResponse,
	BrowserCodingRepositorySource,
	BrowserCodingRepositorySummary,
	BrowserCodingSessionDeleteResponse,
	BrowserCodingSessionDetail,
	BrowserCodingSessionPageResponse,
	BrowserCodingSessionResumeResponse,
	BrowserCodingSessionStartResponse,
	BrowserCodingSessionSummary,
	BrowserConfigResponse,
	BrowserCronEntry,
	BrowserCronHistoryCursor,
	BrowserCronHistoryResponse,
	BrowserFileResponse,
	BrowserGitCommitResponse,
	BrowserGitDiffResponse,
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
	ImageMediaType,
	ImageRef,
	ProviderModelInfo,
	SessionCursor,
	TranscriptTurn,
	WorkspaceFileEntry,
} from "../../common/protocol.ts";
import type {
	CodingRepositoryRecord,
	CodingRepositoryStore,
	CodingRuntime,
	CodingSessionDetail,
	CodingSessionEventRecorder,
	CodingSessionStore,
	StoredCodingSessionEvent,
} from "../coding/index.ts";
import { replayThenFollowCodingSessionEvents } from "../coding/index.ts";
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
import { listWorkspaceFiles } from "./files/list-workspace-files.ts";
import { readBrowserFile } from "./files/read-browser-file.ts";
import { listTreeEntries } from "./files/tree-workbench.ts";
import { writeBrowserFile } from "./files/write-browser-file.ts";
import {
	initGitRepo as initGitRepoWorkbench,
	normalizeGitPaths,
	readAgentFileGitChange,
	readAgentTreeGitStatuses,
	readGitCommit as readGitCommitWorkbench,
	readGitDiff as readGitDiffWorkbench,
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

// The browser API only needs the start/resume slice of the coding runtime,
// plus an optional model catalog supplied by the surrounding CodingService.
// Accept the full CodingRuntime slice directly so production wiring and tests
// share one source of truth for method signatures.
export interface BrowserCodingService
	extends Pick<CodingRuntime, "startPrompt" | "resumePrompt"> {
	listModels?(): Promise<ProviderModelInfo[]>;
}

interface CreateBrowserApiOptions {
	agents: BrowserApiAgent[];
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
		((sessionId: string) => Promise<TranscriptTurn[]>) | undefined
	>;
	storesByAgent: Map<string, SessionStore | undefined>;
}

export interface BrowserApi {
	getAgentTerminalCwd(agentId: string): string | undefined;
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
	listCodingSessions(params: {
		limit: number;
		cursor?: SessionCursor;
		linkedChatSessionId?: string;
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
	archiveCodingRepository(
		repositoryId: string,
	): Promise<BrowserCodingRepositoryArchiveResponse>;
	pickCodingRepositoryFolder(): Promise<BrowserCodingFolderPickerResponse>;
	getCodingSession(
		providerId: string,
		sdkSessionId: string,
	): Promise<BrowserCodingSessionDetail>;
	deleteCodingSession(
		providerId: string,
		sdkSessionId: string,
	): Promise<BrowserCodingSessionDeleteResponse>;
	renameCodingSession(
		providerId: string,
		sdkSessionId: string,
		title: string,
	): Promise<BrowserCodingSessionDetail>;
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
	listCodingModels(): Promise<BrowserCodingModelsResponse>;
	openCodingSessionEventStream(params: {
		providerId: string;
		sdkSessionId: string;
		sinceSequence?: number;
		signal?: AbortSignal;
	}): AsyncIterable<StoredCodingSessionEvent>;
	listAgentTree(agentId: string): Promise<BrowserTreeEntry[]>;
	listAgentGraph(agentId: string): Promise<BrowserGraphResponse>;
	listAgentWorkspaceFiles(agentId: string): Promise<WorkspaceFileEntry[]>;
	listCodingRepositoryTree(repositoryId: string): Promise<BrowserTreeEntry[]>;
	getCodingRepositoryCwd(repositoryId: string): string | undefined;
	readConfigFile(): Promise<BrowserConfigResponse>;
	writeConfigFile(
		document: Record<string, unknown>,
	): Promise<BrowserConfigResponse>;
	writeAgentTerminalRunCommand(
		agentId: string,
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
	}): Promise<BrowserGitStatusResponse>;
	readGitCommit(
		sha: string,
		params?: { repositoryId?: string },
	): Promise<BrowserGitCommitResponse>;
	readGitDiff(
		path: string,
		params?: { repositoryId?: string },
	): Promise<BrowserGitDiffResponse>;
	readGitStatus(params?: {
		repositoryId?: string;
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
	const pickCodingFolder =
		options.pickCodingFolder ?? createNativeFolderPicker();

	function resolveRepositoryCwd(repositoryId: string): string {
		const repository = options.codingRepositories?.get(repositoryId);
		if (!repository) {
			throw new Error(`Unknown coding repository: ${repositoryId}`);
		}
		return repository.rootCwd;
	}

	function resolveGitCwd(params?: { repositoryId?: string }): string {
		if (params?.repositoryId) {
			return resolveRepositoryCwd(params.repositoryId);
		}
		return options.gitRoot;
	}

	return {
		getAgentTerminalCwd(agentId) {
			return agentsById.get(agentId)?.homeDir;
		},
		getCodingRepositoryCwd(repositoryId) {
			return options.codingRepositories?.get(repositoryId)?.rootCwd;
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
		async listAgentCron(agentId) {
			const agent = requireAgent(agentsById, agentId);
			return await listCronEntries(agent.homeDir);
		},
		async listAgentCronHistory(agentId, params) {
			const agent = requireAgent(agentsById, agentId);
			const store = options.storesByAgent.get(agentId);
			if (!store) {
				return { entries: [], hasMore: false };
			}
			const readTranscript = options.readTranscriptsByAgent?.get(agentId);
			return listCronRunsForJob(store, params.jobName, {
				limit: params.limit,
				before: params.before,
				readTranscript: readTranscript
					? (providerId, sessionId) =>
							providerId === agent.providerId
								? readTranscript(sessionId)
								: Promise.resolve(undefined)
					: undefined,
			});
		},
		async listAgentInbox(agentId) {
			const agent = requireAgent(agentsById, agentId);
			return await listInboxEntries(agent.homeDir);
		},
		async listAgentSessions(agentId, params) {
			const agent = requireAgent(agentsById, agentId);
			const store = options.storesByAgent.get(agentId);
			if (!store) {
				return { sessions: [] };
			}
			const query = params.query?.trim();
			const listOptions = {
				cursor: params.cursor,
				limit: params.limit,
				providerId: agent.providerId,
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
		async listCodingSessions(params) {
			const store = options.codingSessions;
			if (!store) {
				return { sessions: [] };
			}
			const query = params.query?.trim();
			const result = store.list({
				cursor: params.cursor,
				linkedChatSessionId: params.linkedChatSessionId,
				limit: params.limit,
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
		async getCodingSession(providerId, sdkSessionId) {
			const session = options.codingSessions?.getDetail(
				providerId,
				sdkSessionId,
			);
			if (!session) {
				throw new Error(
					`Unknown coding session: ${providerId}/${sdkSessionId}`,
				);
			}
			return toBrowserCodingSessionSummary(session);
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
			const log = options.codingEvents;
			if (!log) {
				return emptyAsyncIterable();
			}
			return replayThenFollowCodingSessionEvents(log, {
				providerId: params.providerId,
				sdkSessionId: params.sdkSessionId,
				...(params.sinceSequence !== undefined
					? { sinceSequence: params.sinceSequence }
					: {}),
				...(params.signal ? { signal: params.signal } : {}),
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
			return coding.resumePrompt({
				providerId: params.providerId,
				sdkSessionId: params.sdkSessionId,
				prompt,
				...(params.model ? { model: params.model } : {}),
				...(params.effort ? { effort: params.effort } : {}),
				...(params.serviceTier ? { serviceTier: params.serviceTier } : {}),
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
			return readGitStatusWorkbench(resolveGitCwd(params), ignoredGitPaths);
		},
		async initGitRepo(params) {
			return initGitRepoWorkbench(resolveGitCwd(params), ignoredGitPaths);
		},
		async readGitCommit(sha, params) {
			return readGitCommitWorkbench(resolveGitCwd(params), sha);
		},
		async readGitDiff(path, params) {
			return readGitDiffWorkbench(resolveGitCwd(params), path);
		},
		async listCodingRepositoryTree(repositoryId) {
			const cwd = resolveRepositoryCwd(repositoryId);
			const gitStatuses = readAgentTreeGitStatuses(cwd, cwd, ignoredGitPaths);
			return await listTreeEntries(cwd, cwd, gitStatuses);
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

function normalizeTerminalRunCommand(command: string): string {
	const nextCommand = command.trim();
	if (nextCommand.includes("\n") || nextCommand.includes("\r")) {
		throw new Error("Terminal run command must be a single line");
	}
	return nextCommand;
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
