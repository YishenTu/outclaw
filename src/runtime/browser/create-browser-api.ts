import type { Dirent } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import type {
	BrowserAgentsResponse,
	BrowserCronEntry,
	BrowserFileResponse,
	BrowserGitDiffResponse,
	BrowserGitStatusResponse,
	BrowserTreeEntry,
} from "../../common/protocol.ts";
import { parseJobConfig, serializeJobConfig } from "../cron/job-config.ts";
import type { SessionStore } from "../persistence/session-store.ts";

const MAX_FILE_PREVIEW_BYTES = 512 * 1024;
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
			return await listTreeEntries(agent.homeDir, agent.homeDir);
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
					language: detectLanguage(path),
					truncated,
				};
			}

			return {
				path,
				kind: "text",
				content: new TextDecoder().decode(previewBuffer),
				language: detectLanguage(path),
				truncated,
			};
		},
		async readGitStatus() {
			const output = runGit(
				options.gitRoot,
				["status", "--porcelain=v1", "--branch"],
				false,
			);
			return parseGitStatus(
				output,
				options.gitRoot,
				readGitGraph(options.gitRoot),
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
				return {
					children: await listTreeEntries(rootDir, absolutePath),
					kind: "directory" as const,
					name: entry.name,
					path,
				};
			}

			return {
				kind: "file" as const,
				name: entry.name,
				path,
			};
		}),
	);
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

function looksBinary(buffer: Uint8Array): boolean {
	const sampleSize = Math.min(buffer.byteLength, 1024);
	for (let index = 0; index < sampleSize; index += 1) {
		if (buffer[index] === 0) {
			return true;
		}
	}
	return false;
}

function detectLanguage(path: string): string | undefined {
	switch (extname(path).toLowerCase()) {
		case ".md":
			return "markdown";
		case ".ts":
			return "typescript";
		case ".tsx":
			return "tsx";
		case ".js":
			return "javascript";
		case ".jsx":
			return "jsx";
		case ".json":
			return "json";
		case ".yml":
		case ".yaml":
			return "yaml";
		case ".sh":
			return "bash";
		case ".css":
			return "css";
		case ".html":
			return "html";
		case ".sql":
			return "sql";
		default:
			return undefined;
	}
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
	graph: string,
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

	return {
		root,
		branch,
		ahead,
		behind,
		clean: fileLines.length === 0,
		graph,
		files: fileLines.map((line) => {
			const indexStatus = line.slice(0, 1);
			const worktreeStatus = line.slice(1, 2);
			const rawPath = line.slice(3);
			const renamedParts = rawPath.split(" -> ");
			return {
				path: renamedParts[1] ?? renamedParts[0] ?? rawPath,
				indexStatus,
				worktreeStatus,
				renamedFrom:
					renamedParts.length > 1 ? (renamedParts[0] ?? rawPath) : undefined,
			};
		}),
	};
}

function readGitGraph(root: string): string {
	const result = Bun.spawnSync(
		[
			"git",
			"log",
			"--graph",
			"--decorate",
			"--oneline",
			"--all",
			"-12",
			"--no-color",
		],
		{
			cwd: root,
			stderr: "pipe",
			stdout: "pipe",
		},
	);
	if (result.exitCode !== 0) {
		return "";
	}
	return result.stdout.toString().trimEnd();
}
