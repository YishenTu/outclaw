import { writeFile } from "node:fs/promises";
import type {
	BrowserAgentsResponse,
	BrowserConfigResponse,
	BrowserCronEntry,
	BrowserFileResponse,
	BrowserGitCommitResponse,
	BrowserGitDiffResponse,
	BrowserGitStatusResponse,
	BrowserInboxArchiveResponse,
	BrowserInboxCreateNoteInput,
	BrowserInboxCreateNoteResponse,
	BrowserInboxResponse,
	BrowserInboxRestoreResponse,
	BrowserTerminalRunCommandResponse,
	BrowserTreeEntry,
	ImageMediaType,
	ImageRef,
} from "../../common/protocol.ts";
import { readStoredAgentConfig, writeStoredAgentConfig } from "../config.ts";
import { saveManagedImage } from "../files/managed-image-store.ts";
import type { SessionStore } from "../persistence/session-store/session-store.ts";
import {
	type BrowserApiAgent,
	listBrowserAgents,
} from "./agent-sidebar-read-model.ts";
import { BROWSER_CONFIG_SCHEMA } from "./config-schema.ts";
import { listCronEntries, setCronEnabled } from "./cron-workbench.ts";
import { listTreeEntries } from "./file-tree-workbench.ts";
import {
	initGitRepo as initGitRepoWorkbench,
	normalizeGitPaths,
	readAgentTreeGitStatuses,
	readGitCommit as readGitCommitWorkbench,
	readGitDiff as readGitDiffWorkbench,
	readGitStatus as readGitStatusWorkbench,
} from "./git-workbench.ts";
import {
	archiveInboxItem,
	createInboxNote,
	listInboxEntries,
	restoreInboxItem,
} from "./inbox-workbench.ts";
import {
	resolveExistingPathWithinRoot,
	resolveWritablePathWithinRoot,
} from "./path-safety.ts";
import { readBrowserFile } from "./read-browser-file.ts";

interface CreateBrowserApiOptions {
	agents: BrowserApiAgent[];
	filesRoot?: string;
	getRememberedAgentId: () => string | undefined;
	gitRoot: string;
	homeDir: string;
	ignoredGitPaths?: readonly string[];
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
	listAgentInbox(agentId: string): Promise<BrowserInboxResponse>;
	listAgentTree(agentId: string): Promise<BrowserTreeEntry[]>;
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
		async listAgentInbox(agentId) {
			const agent = requireAgent(agentsById, agentId);
			return await listInboxEntries(agent.homeDir);
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
			return await readBrowserFile(agent.homeDir, absolutePath);
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
