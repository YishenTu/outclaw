import { writeFile } from "node:fs/promises";
import type {
	BrowserAgentsResponse,
	BrowserCodingRepositoryArchiveResponse,
	BrowserCodingRepositoryDetail,
	BrowserCodingRepositoryListResponse,
	BrowserCodingRepositorySource,
	BrowserCodingRepositorySummary,
	BrowserCodingSessionDeleteResponse,
	BrowserCodingSessionDetail,
	BrowserCodingSessionPageResponse,
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
	SessionCursor,
	TranscriptTurn,
	WorkspaceFileEntry,
} from "../../common/protocol.ts";
import type {
	CodingRepositoryRecord,
	CodingRepositoryStore,
	CodingSessionDetail,
	CodingSessionStore,
	LinkedChatSession,
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
	toBrowserSessionSummary,
} from "./agent-sidebar/read-model.ts";
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

interface CreateBrowserApiOptions {
	agents: BrowserApiAgent[];
	codingRepositories?: CodingRepositoryStore;
	codingStoresByAgent?: Map<string, CodingSessionStore | undefined>;
	filesRoot?: string;
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
	listAgentCodingSessions(
		agentId: string,
		params: {
			limit: number;
			cursor?: SessionCursor;
			linkedChat?: LinkedChatSession;
			providerId?: string;
			repositoryId?: string;
		},
	): Promise<BrowserCodingSessionPageResponse>;
	listCodingRepositories(params?: {
		includeArchived?: boolean;
	}): Promise<BrowserCodingRepositoryListResponse>;
	getCodingRepository(
		repositoryId: string,
	): Promise<BrowserCodingRepositoryDetail>;
	registerAgentCodingRepository(
		agentId: string,
		params: {
			displayName?: string;
			remoteUrl?: string;
			rootCwd: string;
			source?: Extract<BrowserCodingRepositorySource, "manual" | "clone">;
		},
	): Promise<BrowserCodingRepositoryDetail>;
	archiveCodingRepository(
		repositoryId: string,
	): Promise<BrowserCodingRepositoryArchiveResponse>;
	getAgentCodingSession(
		agentId: string,
		providerId: string,
		sdkSessionId: string,
	): Promise<BrowserCodingSessionDetail>;
	deleteAgentCodingSession(
		agentId: string,
		providerId: string,
		sdkSessionId: string,
	): Promise<BrowserCodingSessionDeleteResponse>;
	listAgentTree(agentId: string): Promise<BrowserTreeEntry[]>;
	listAgentGraph(agentId: string): Promise<BrowserGraphResponse>;
	listAgentWorkspaceFiles(agentId: string): Promise<WorkspaceFileEntry[]>;
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
	initGitRepo(): Promise<BrowserGitStatusResponse>;
	readGitCommit(sha: string): Promise<BrowserGitCommitResponse>;
	readGitDiff(path: string): Promise<BrowserGitDiffResponse>;
	readGitStatus(): Promise<BrowserGitStatusResponse>;
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

	return {
		getAgentTerminalCwd(agentId) {
			return agentsById.get(agentId)?.homeDir;
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
		async listAgentCodingSessions(agentId, params) {
			requireAgent(agentsById, agentId);
			const store = options.codingStoresByAgent?.get(agentId);
			if (!store) {
				return { sessions: [] };
			}
			const result = store.list({
				cursor: params.cursor,
				linkedChat: params.linkedChat,
				limit: params.limit,
				providerId: params.providerId,
				repositoryId: params.repositoryId,
			});
			return {
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
		async registerAgentCodingRepository(agentId, params) {
			requireAgent(agentsById, agentId);
			if (!options.codingRepositories) {
				throw new Error("Coding repository API is not configured");
			}
			return toBrowserCodingRepositorySummary(
				options.codingRepositories.register({
					defaultAgentId: agentId,
					displayName: params.displayName,
					remoteUrl: params.remoteUrl,
					rootCwd: params.rootCwd,
					source: params.source ?? "manual",
				}),
			);
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
		async getAgentCodingSession(agentId, providerId, sdkSessionId) {
			requireAgent(agentsById, agentId);
			const session = options.codingStoresByAgent
				?.get(agentId)
				?.getDetail(providerId, sdkSessionId);
			if (!session) {
				throw new Error(
					`Unknown coding session: ${providerId}/${sdkSessionId}`,
				);
			}
			return toBrowserCodingSessionSummary(session);
		},
		async deleteAgentCodingSession(agentId, providerId, sdkSessionId) {
			requireAgent(agentsById, agentId);
			const store = options.codingStoresByAgent?.get(agentId);
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
		async readGitStatus() {
			return readGitStatusWorkbench(options.gitRoot, ignoredGitPaths);
		},
		async initGitRepo() {
			return initGitRepoWorkbench(options.gitRoot, ignoredGitPaths);
		},
		async readGitCommit(sha) {
			return readGitCommitWorkbench(options.gitRoot, sha);
		},
		async readGitDiff(path) {
			return readGitDiffWorkbench(options.gitRoot, path);
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
		status: session.status,
		createdAt: session.createdAt,
		source: session.source,
		tag: session.tag,
		...(session.ocSessionId ? { ocSessionId: session.ocSessionId } : {}),
		...(session.linkedChat ? { linkedChat: session.linkedChat } : {}),
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
		defaultAgentId: repository.defaultAgentId,
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
