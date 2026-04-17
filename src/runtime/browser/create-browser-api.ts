import type { Dirent } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type {
	BrowserAgentsResponse,
	BrowserCronEntry,
	BrowserFileResponse,
	BrowserGitDiffResponse,
	BrowserGitFileStatus,
	BrowserGitGraph,
	BrowserGitGraphBranchHead,
	BrowserGitGraphCommit,
	BrowserGitStatusResponse,
	BrowserTreeEntry,
	BrowserTreeEntryGitStatus,
} from "../../common/protocol.ts";
import { parseJobConfig, serializeJobConfig } from "../cron/job-config.ts";
import type { SessionStore } from "../persistence/session-store.ts";
import { detectFileLanguage } from "./detect-file-language.ts";

const MAX_FILE_PREVIEW_BYTES = 512 * 1024;
const MAX_GIT_GRAPH_COMMITS = 30;
const TREE_IGNORED_NAMES = new Set([".git", ".DS_Store"]);

interface BrowserApiAgent {
	agentId: string;
	name: string;
	homeDir: string;
	providerId: string;
}

interface CreateBrowserApiOptions {
	agents: BrowserApiAgent[];
	getRememberedAgentId: () => string | undefined;
	gitRoot: string;
	storesByAgent: Map<string, SessionStore | undefined>;
}

export interface BrowserApi {
	getAgentTerminalCwd(agentId: string): string | undefined;
	listAgents(): BrowserAgentsResponse;
	listAgentCron(agentId: string): Promise<BrowserCronEntry[]>;
	listAgentTree(agentId: string): Promise<BrowserTreeEntry[]>;
	readAgentFile(
		agentId: string,
		relativePath: string,
	): Promise<BrowserFileResponse>;
	readGitDiff(path: string): Promise<BrowserGitDiffResponse>;
	readGitStatus(): Promise<BrowserGitStatusResponse>;
	setAgentCronEnabled(
		agentId: string,
		relativePath: string,
		enabled: boolean,
	): Promise<BrowserCronEntry>;
}

export function createBrowserApi(options: CreateBrowserApiOptions): BrowserApi {
	const agentsById = new Map(
		options.agents.map((agent) => [agent.agentId, agent] as const),
	);

	return {
		getAgentTerminalCwd(agentId) {
			return agentsById.get(agentId)?.homeDir;
		},
		listAgents() {
			return {
				activeAgentId: options.getRememberedAgentId(),
				agents: options.agents
					.slice()
					.sort((left, right) => left.name.localeCompare(right.name))
					.map((agent) => {
						const store = options.storesByAgent.get(agent.agentId);
						const sessions =
							store?.list(50, "chat").map((session) => ({
								providerId: session.providerId,
								sdkSessionId: session.sdkSessionId,
								title: session.title,
								model: session.model,
								lastActive: session.lastActive,
							})) ?? [];
						const activeSessionId = store?.getActiveSessionId(agent.providerId);
						return {
							agentId: agent.agentId,
							name: agent.name,
							activeSession: activeSessionId
								? {
										providerId: agent.providerId,
										sdkSessionId: activeSessionId,
									}
								: undefined,
							sessions,
						};
					}),
			};
		},
		async listAgentCron(agentId) {
			const agent = requireAgent(agentsById, agentId);
			return await listCronEntries(agent.homeDir);
		},
		async setAgentCronEnabled(agentId, relativePath, enabled) {
			const agent = requireAgent(agentsById, agentId);
			const absolutePath = resolveWithinCronDirectory(
				agent.homeDir,
				relativePath,
			);
			const content = await readFile(absolutePath, "utf8");
			const config = parseJobConfig(content);
			const nextConfig = { ...config, enabled };
			await writeFile(absolutePath, serializeJobConfig(nextConfig), "utf8");
			return toBrowserCronEntry(agent.homeDir, absolutePath, nextConfig);
		},
		async listAgentTree(agentId) {
			const agent = requireAgent(agentsById, agentId);
			const gitStatuses = readAgentTreeGitStatuses(
				options.gitRoot,
				agent.homeDir,
			);
			return await listTreeEntries(agent.homeDir, agent.homeDir, gitStatuses);
		},
		async readAgentFile(agentId, relativePath) {
			const agent = requireAgent(agentsById, agentId);
			const absolutePath = resolveWithinRoot(agent.homeDir, relativePath);
			const info = await stat(absolutePath);
			if (!info.isFile()) {
				throw new Error("Path does not reference a file");
			}

			const fileBuffer = await readFile(absolutePath);
			const truncated = fileBuffer.byteLength > MAX_FILE_PREVIEW_BYTES;
			const previewBuffer = truncated
				? fileBuffer.subarray(0, MAX_FILE_PREVIEW_BYTES)
				: fileBuffer;
			const path = toRelativePath(agent.homeDir, absolutePath);
			if (looksBinary(previewBuffer)) {
				return {
					path,
					kind: "binary",
					language: detectFileLanguage(path),
					truncated,
				};
			}

			return {
				path,
				kind: "text",
				content: new TextDecoder().decode(previewBuffer),
				language: detectFileLanguage(path),
				truncated,
			};
		},
		async readGitStatus() {
			const output = runGit(
				options.gitRoot,
				["status", "--porcelain=v1", "--branch", "--untracked-files=all"],
				false,
			);
			return parseGitStatus(
				output,
				options.gitRoot,
				readGitGraphData(options.gitRoot),
			);
		},
		async readGitDiff(path) {
			const absolutePath = resolveWithinRoot(options.gitRoot, path);
			const relativePath = toRelativePath(options.gitRoot, absolutePath);
			let diff = runGit(
				options.gitRoot,
				["diff", "--no-ext-diff", "--binary", "HEAD", "--", relativePath],
				false,
			);

			if (diff.trim() === "") {
				diff = runProcess(
					["git", "diff", "--no-index", "--binary", "/dev/null", absolutePath],
					options.gitRoot,
					true,
				);
			}

			return {
				path: relativePath,
				diff,
			};
		},
	};
}

async function listCronEntries(rootDir: string): Promise<BrowserCronEntry[]> {
	const cronDir = resolve(rootDir, "cron");
	let entries: Dirent[];
	try {
		entries = await readdir(cronDir, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return [];
		}
		throw error;
	}

	const cronFiles = entries
		.filter(
			(entry) =>
				entry.isFile() &&
				(entry.name.endsWith(".yaml") || entry.name.endsWith(".yml")),
		)
		.sort((left, right) => left.name.localeCompare(right.name));

	return await Promise.all(
		cronFiles.map(async (entry) => {
			const absolutePath = resolve(cronDir, entry.name);
			const content = await readFile(absolutePath, "utf8");
			try {
				const config = parseJobConfig(content);
				return toBrowserCronEntry(rootDir, absolutePath, config);
			} catch (error) {
				return {
					name: entry.name,
					path: toRelativePath(rootDir, absolutePath),
					schedule: "Invalid config",
					enabled: false,
					error:
						error instanceof Error ? error.message : "Failed to parse cron job",
				};
			}
		}),
	);
}

function toBrowserCronEntry(
	rootDir: string,
	absolutePath: string,
	config: { enabled: boolean; model?: string; name: string; schedule: string },
): BrowserCronEntry {
	return {
		name: config.name,
		path: toRelativePath(rootDir, absolutePath),
		schedule: config.schedule,
		model: config.model,
		enabled: config.enabled,
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

async function listTreeEntries(
	rootDir: string,
	currentDir: string,
	gitStatuses: ReadonlyMap<string, BrowserTreeEntryGitStatus>,
): Promise<BrowserTreeEntry[]> {
	const entries = await readdir(currentDir, { withFileTypes: true });
	const visibleEntries = entries
		.filter((entry) => !TREE_IGNORED_NAMES.has(entry.name))
		.sort((left, right) => {
			if (left.isDirectory() && !right.isDirectory()) {
				return -1;
			}
			if (!left.isDirectory() && right.isDirectory()) {
				return 1;
			}
			return left.name.localeCompare(right.name);
		});

	return await Promise.all(
		visibleEntries.map(async (entry) => {
			const absolutePath = resolve(currentDir, entry.name);
			const path = toRelativePath(rootDir, absolutePath);
			if (entry.isDirectory()) {
				const children = await listTreeEntries(
					rootDir,
					absolutePath,
					gitStatuses,
				);
				const gitStatus = aggregateTreeEntryGitStatus(children);
				return {
					children,
					kind: "directory" as const,
					name: entry.name,
					path,
					...(gitStatus ? { gitStatus } : {}),
				};
			}

			const gitStatus = gitStatuses.get(path);
			return {
				kind: "file" as const,
				name: entry.name,
				path,
				...(gitStatus ? { gitStatus } : {}),
			};
		}),
	);
}

function readAgentTreeGitStatuses(
	gitRoot: string,
	agentHomeDir: string,
): Map<string, BrowserTreeEntryGitStatus> {
	const relativeAgentRoot = toRelativeDescendantPath(gitRoot, agentHomeDir);
	if (relativeAgentRoot === undefined) {
		return new Map();
	}

	try {
		const output = runGit(
			gitRoot,
			[
				"status",
				"--porcelain=v1",
				"--untracked-files=all",
				"--",
				relativeAgentRoot === "" ? "." : relativeAgentRoot,
			],
			false,
		);
		return toAgentTreeGitStatuses(output, relativeAgentRoot);
	} catch {
		return new Map();
	}
}

function toAgentTreeGitStatuses(
	output: string,
	relativeAgentRoot: string,
): Map<string, BrowserTreeEntryGitStatus> {
	const statuses = new Map<string, BrowserTreeEntryGitStatus>();
	const fileLines = output
		.split(/\r?\n/)
		.map((line) => line.trimEnd())
		.filter((line) => line !== "");

	for (const line of fileLines) {
		const fileStatus = parseGitFileStatusLine(line);
		if (!fileStatus) {
			continue;
		}
		const gitStatus = classifyTreeEntryGitStatus(fileStatus);
		if (!gitStatus) {
			continue;
		}
		const path = toAgentTreeRelativePath(fileStatus.path, relativeAgentRoot);
		if (!path) {
			continue;
		}
		statuses.set(path, mergeTreeEntryGitStatus(statuses.get(path), gitStatus));
	}

	return statuses;
}

function toAgentTreeRelativePath(
	gitRelativePath: string,
	relativeAgentRoot: string,
): string | undefined {
	if (relativeAgentRoot === "") {
		return gitRelativePath;
	}

	const prefix = `${relativeAgentRoot}/`;
	if (!gitRelativePath.startsWith(prefix)) {
		return undefined;
	}

	return gitRelativePath.slice(prefix.length);
}

function classifyTreeEntryGitStatus(
	fileStatus: BrowserGitFileStatus,
): BrowserTreeEntryGitStatus | undefined {
	if (
		fileStatus.indexStatus === "?" ||
		fileStatus.worktreeStatus === "?" ||
		fileStatus.indexStatus === "A" ||
		fileStatus.worktreeStatus === "A"
	) {
		return "new";
	}

	if (fileStatus.indexStatus !== " " || fileStatus.worktreeStatus !== " ") {
		return "modified";
	}

	return undefined;
}

function mergeTreeEntryGitStatus(
	current: BrowserTreeEntryGitStatus | undefined,
	incoming: BrowserTreeEntryGitStatus,
): BrowserTreeEntryGitStatus {
	if (current === "new" || incoming === "new") {
		return "new";
	}
	return incoming;
}

function aggregateTreeEntryGitStatus(
	children: BrowserTreeEntry[],
): BrowserTreeEntryGitStatus | undefined {
	if (children.some((child) => child.gitStatus === "new")) {
		return "new";
	}
	if (children.some((child) => child.gitStatus === "modified")) {
		return "modified";
	}
	return undefined;
}

function resolveWithinRoot(rootDir: string, targetPath: string): string {
	if (targetPath.trim() === "") {
		throw new Error("Path is required");
	}

	const resolvedRoot = resolve(rootDir);
	const resolvedTarget = resolve(resolvedRoot, targetPath);
	if (
		resolvedTarget !== resolvedRoot &&
		!resolvedTarget.startsWith(`${resolvedRoot}${sep}`)
	) {
		throw new Error("Path escapes agent home");
	}
	return resolvedTarget;
}

function resolveWithinCronDirectory(
	rootDir: string,
	targetPath: string,
): string {
	const cronDir = resolve(rootDir, "cron");
	const resolvedTarget = resolveWithinRoot(rootDir, targetPath);
	if (
		resolvedTarget !== cronDir &&
		!resolvedTarget.startsWith(`${cronDir}${sep}`)
	) {
		throw new Error("Path escapes cron directory");
	}

	return resolvedTarget;
}

function toRelativePath(rootDir: string, absolutePath: string): string {
	return relative(rootDir, absolutePath).split(sep).join("/");
}

function toRelativeDescendantPath(
	rootDir: string,
	absolutePath: string,
): string | undefined {
	const resolvedRoot = resolve(rootDir);
	const resolvedTarget = resolve(absolutePath);
	if (resolvedTarget === resolvedRoot) {
		return "";
	}
	if (!resolvedTarget.startsWith(`${resolvedRoot}${sep}`)) {
		return undefined;
	}
	return relative(resolvedRoot, resolvedTarget).split(sep).join("/");
}

function looksBinary(buffer: Uint8Array): boolean {
	const sampleSize = Math.min(buffer.byteLength, 1024);
	for (let index = 0; index < sampleSize; index += 1) {
		if (buffer[index] === 0) {
			return true;
		}
	}
	return false;
}

function runGit(
	cwd: string,
	args: string[],
	allowExitCodeOne: boolean,
): string {
	return runProcess(["git", ...args], cwd, allowExitCodeOne);
}

function runProcess(
	cmd: string[],
	cwd: string,
	allowExitCodeOne: boolean,
): string {
	const result = Bun.spawnSync(cmd, {
		cwd,
		stderr: "pipe",
		stdout: "pipe",
	});
	if (result.exitCode === 0 || (allowExitCodeOne && result.exitCode === 1)) {
		return result.stdout.toString();
	}

	throw new Error(
		result.stderr.toString().trim() || `Command failed: ${cmd[0]}`,
	);
}

function parseGitStatus(
	output: string,
	root: string,
	graph: BrowserGitGraph,
): BrowserGitStatusResponse {
	const lines = output
		.split(/\r?\n/)
		.map((line) => line.trimEnd())
		.filter((line) => line !== "");
	const branchLine = lines.find((line) => line.startsWith("## "));
	const fileLines = lines.filter((line) => !line.startsWith("## "));

	let branch: string | null = null;
	let ahead = 0;
	let behind = 0;
	if (branchLine) {
		const branchMatch = branchLine.match(/^## ([^. ]+)/);
		branch = branchMatch?.[1] ?? null;
		const aheadMatch = branchLine.match(/ahead (\d+)/);
		const behindMatch = branchLine.match(/behind (\d+)/);
		ahead = Number(aheadMatch?.[1] ?? 0);
		behind = Number(behindMatch?.[1] ?? 0);
	}

	const files = fileLines
		.map((line) => parseGitFileStatusLine(line))
		.filter((file): file is BrowserGitFileStatus => file !== undefined)
		.map((file) => ({
			...file,
			...readGitFileLineCounts(root, file),
		}));

	return {
		root,
		branch,
		ahead,
		behind,
		clean: files.length === 0,
		graph,
		files,
	};
}

function parseGitFileStatusLine(
	line: string,
): BrowserGitFileStatus | undefined {
	if (line.length < 4) {
		return undefined;
	}

	const indexStatus = line.slice(0, 1);
	const worktreeStatus = line.slice(1, 2);
	const rawPath = line.slice(3);
	const renamedParts = rawPath.split(" -> ");
	return {
		path: renamedParts[1] ?? renamedParts[0] ?? rawPath,
		indexStatus,
		worktreeStatus,
		additions: 0,
		deletions: 0,
		renamedFrom:
			renamedParts.length > 1 ? (renamedParts[0] ?? rawPath) : undefined,
	};
}

function readGitFileLineCounts(
	root: string,
	file: BrowserGitFileStatus,
): { additions: number; deletions: number } {
	const trackedOutput = runGit(
		root,
		[
			"diff",
			"--numstat",
			"-M",
			"HEAD",
			"--",
			...(file.renamedFrom ? [file.renamedFrom, file.path] : [file.path]),
		],
		false,
	);
	const trackedCounts = parseGitNumstatOutput(trackedOutput);
	if (trackedCounts) {
		return trackedCounts;
	}

	if (file.indexStatus === "?" || file.worktreeStatus === "?") {
		const absolutePath = resolveWithinRoot(root, file.path);
		const untrackedOutput = runProcess(
			["git", "diff", "--no-index", "--numstat", "/dev/null", absolutePath],
			root,
			true,
		);
		return (
			parseGitNumstatOutput(untrackedOutput) ?? { additions: 0, deletions: 0 }
		);
	}

	return { additions: 0, deletions: 0 };
}

function parseGitNumstatOutput(
	output: string,
): { additions: number; deletions: number } | undefined {
	const lines = output
		.split(/\r?\n/)
		.map((line) => line.trimEnd())
		.filter((line) => line !== "");
	if (lines.length === 0) {
		return undefined;
	}

	let additions = 0;
	let deletions = 0;
	for (const line of lines) {
		const [rawAdditions, rawDeletions] = line.split("\t");
		additions += parseGitNumstatCount(rawAdditions);
		deletions += parseGitNumstatCount(rawDeletions);
	}
	return { additions, deletions };
}

function parseGitNumstatCount(value: string | undefined): number {
	if (!value || value === "-") {
		return 0;
	}
	const count = Number.parseInt(value, 10);
	return Number.isFinite(count) ? count : 0;
}

function readGitGraphData(root: string): BrowserGitGraph {
	return {
		commits: readGitGraphCommits(root),
		branchHeads: readGitGraphBranchHeads(root),
	};
}

function readGitGraphCommits(root: string): BrowserGitGraphCommit[] {
	const result = Bun.spawnSync(
		[
			"git",
			"log",
			"--all",
			`-${MAX_GIT_GRAPH_COMMITS}`,
			"--format=%H%x1f%P%x1f%an%x1f%aI%x1f%s",
			"--no-color",
		],
		{
			cwd: root,
			stderr: "pipe",
			stdout: "pipe",
		},
	);
	if (result.exitCode !== 0) {
		return [];
	}

	return result.stdout
		.toString()
		.trimEnd()
		.split(/\r?\n/)
		.filter((line) => line !== "")
		.map((line) => parseGitGraphCommitLine(line))
		.filter((commit): commit is BrowserGitGraphCommit => commit !== undefined);
}

function parseGitGraphCommitLine(
	line: string,
): BrowserGitGraphCommit | undefined {
	const [sha, parentsValue, authorName, authorDate, message] =
		line.split("\x1f");
	if (
		sha === undefined ||
		authorName === undefined ||
		authorDate === undefined ||
		message === undefined
	) {
		return undefined;
	}

	return {
		sha,
		commit: {
			author: {
				name: authorName,
				date: authorDate,
			},
			message,
		},
		parents:
			parentsValue
				?.split(" ")
				.filter((parent) => parent !== "")
				.map((sha) => ({
					sha,
				})) ?? [],
	};
}

function readGitGraphBranchHeads(root: string): BrowserGitGraphBranchHead[] {
	const result = Bun.spawnSync(
		[
			"git",
			"for-each-ref",
			"refs/heads",
			"--format=%(refname:short)\t%(objectname)",
		],
		{
			cwd: root,
			stderr: "pipe",
			stdout: "pipe",
		},
	);
	if (result.exitCode !== 0) {
		return [];
	}

	return result.stdout
		.toString()
		.trimEnd()
		.split(/\r?\n/)
		.filter((line) => line !== "")
		.map((line): BrowserGitGraphBranchHead | undefined => {
			const [name, sha] = line.split("\t");
			if (!name || !sha) {
				return undefined;
			}
			return {
				name,
				commit: {
					sha,
				},
			};
		})
		.filter(
			(branch): branch is BrowserGitGraphBranchHead => branch !== undefined,
		);
}
