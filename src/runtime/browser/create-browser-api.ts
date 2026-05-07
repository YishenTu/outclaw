import { writeFile } from "node:fs/promises";
import type {
	BrowserAgentsResponse,
	BrowserConfigResponse,
	BrowserCronEntry,
	BrowserCronHistoryCursor,
	BrowserCronHistoryResponse,
	BrowserFileResponse,
	BrowserGitCommitResponse,
	BrowserGitDiffResponse,
	BrowserGitStatusResponse,
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
import { listWorkspaceFiles } from "./files/list-workspace-files.ts";
import { readBrowserFile } from "./files/read-browser-file.ts";
import { listTreeEntries } from "./files/tree-workbench.ts";
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
	filesRoot?: string;
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
	listAgents(): BrowserAgentsResponse;
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
	listAgentTree(agentId: string): Promise<BrowserTreeEntry[]>;
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
		listAgents() {
			return listBrowserAgents({
				agents: agentsById.values(),
				getRememberedAgentId: options.getRememberedAgentId,
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
