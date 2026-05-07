import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import type {
	BrowserFileGitChange,
	BrowserGitCommitResponse,
	BrowserGitDiffResponse,
	BrowserGitFileStatus,
	BrowserGitGraph,
	BrowserGitGraphBranchHead,
	BrowserGitGraphCommit,
	BrowserGitInitializedResponse,
	BrowserGitStatusResponse,
	BrowserTreeEntryGitStatus,
} from "../../../common/protocol.ts";
import {
	normalizeBrowserPath,
	resolveExistingPathWithinRoot,
	resolveWithinRoot,
	toRelativeDescendantPath,
	toRelativePath,
} from "../paths/path-safety.ts";

const MAX_GIT_GRAPH_COMMITS = 30;

export function normalizeGitPaths(paths: readonly string[]): string[] {
	return paths
		.map((path) => normalizeBrowserPath(path))
		.filter((path) => path !== "");
}

export function readGitStatus(
	gitRoot: string,
	ignoredGitPaths: readonly string[],
): BrowserGitStatusResponse {
	if (!isGitRepo(gitRoot)) {
		return { initialized: false, root: gitRoot };
	}
	const output = runGit(
		gitRoot,
		["status", "--porcelain=v1", "--branch", "--untracked-files=all"],
		false,
	);
	return parseGitStatus(
		output,
		gitRoot,
		readGitGraphData(gitRoot),
		ignoredGitPaths,
	);
}

export function initGitRepo(
	gitRoot: string,
	ignoredGitPaths: readonly string[],
): BrowserGitStatusResponse {
	if (!isGitRepo(gitRoot)) {
		runGit(gitRoot, ["init"], false);
	}
	return readGitStatus(gitRoot, ignoredGitPaths);
}

export function readGitDiff(
	gitRoot: string,
	path: string,
): BrowserGitDiffResponse {
	const absolutePath = resolveWithinRoot(gitRoot, path);
	const relativePath = toRelativePath(gitRoot, absolutePath);
	let diff = runGit(
		gitRoot,
		["diff", "--no-ext-diff", "--binary", "HEAD", "--", relativePath],
		false,
	);

	if (diff.trim() === "") {
		const readableAbsolutePath = resolveExistingPathWithinRoot(gitRoot, path);
		diff = runProcess(
			[
				"git",
				"diff",
				"--no-index",
				"--binary",
				"/dev/null",
				readableAbsolutePath,
			],
			gitRoot,
			true,
		);
	}

	return {
		path: relativePath,
		diff,
	};
}

export function readGitCommit(
	root: string,
	sha: string,
): BrowserGitCommitResponse {
	const resolvedSha = resolveGitCommitSha(root, sha);
	const metadata = runGit(
		root,
		[
			"show",
			"--no-patch",
			`--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%B`,
			resolvedSha,
		],
		false,
	).trimEnd();
	const [resolved, parentsValue, authorName, authorEmail, authorDate, message] =
		metadata.split("\x1f");
	if (
		resolved === undefined ||
		parentsValue === undefined ||
		authorName === undefined ||
		authorEmail === undefined ||
		authorDate === undefined ||
		message === undefined
	) {
		throw new Error(`Failed to parse commit metadata: ${resolvedSha}`);
	}

	const parents = parentsValue
		.split(" ")
		.filter((parent) => parent !== "")
		.map((parentSha) => ({
			sha: parentSha,
		}));
	const diff =
		parents[0] === undefined
			? runGit(
					root,
					["show", "--format=", "--no-ext-diff", "--binary", resolvedSha],
					false,
				)
			: runGit(
					root,
					["diff", "--no-ext-diff", "--binary", parents[0].sha, resolvedSha],
					false,
				);

	return {
		sha: resolved,
		author: {
			name: authorName,
			email: authorEmail,
			date: authorDate,
		},
		message: message.trimEnd(),
		parents,
		diff,
	};
}

export function readAgentTreeGitStatuses(
	gitRoot: string,
	agentHomeDir: string,
	ignoredGitPaths: readonly string[],
): Map<string, BrowserTreeEntryGitStatus> {
	return new Map(
		[...readAgentTreeGitChanges(gitRoot, agentHomeDir, ignoredGitPaths)].map(
			([path, change]) => [path, change.status],
		),
	);
}

export function readAgentFileGitChange(
	gitRoot: string,
	agentHomeDir: string,
	relativePath: string,
	ignoredGitPaths: readonly string[],
): BrowserFileGitChange | undefined {
	const normalizedPath = normalizeBrowserPath(relativePath);
	if (normalizedPath === "") {
		return undefined;
	}

	return readAgentTreeGitChanges(gitRoot, agentHomeDir, ignoredGitPaths).get(
		normalizedPath,
	);
}

function readAgentTreeGitChanges(
	gitRoot: string,
	agentHomeDir: string,
	ignoredGitPaths: readonly string[],
): Map<string, BrowserFileGitChange> {
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
		return toAgentTreeGitChanges(output, relativeAgentRoot, ignoredGitPaths);
	} catch {
		return new Map();
	}
}

export function runGit(
	cwd: string,
	args: string[],
	allowExitCodeOne = false,
): string {
	return runProcess(["git", ...args], cwd, allowExitCodeOne);
}

function gitProcessEnv(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value !== undefined && !key.startsWith("GIT_")) {
			env[key] = value;
		}
	}
	return env;
}

function isGitRepo(cwd: string): boolean {
	const result = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
		cwd,
		env: gitProcessEnv(),
		stderr: "pipe",
		stdout: "pipe",
	});
	if (result.exitCode !== 0) {
		return false;
	}

	return (
		canonicalizePath(result.stdout.toString().trim()) === canonicalizePath(cwd)
	);
}

function canonicalizePath(path: string): string {
	try {
		return realpathSync.native(path);
	} catch {
		return resolve(path);
	}
}

function hasGitHeadCommit(root: string): boolean {
	const result = Bun.spawnSync(
		["git", "rev-parse", "--verify", "HEAD^{commit}"],
		{
			cwd: root,
			env: gitProcessEnv(),
			stderr: "pipe",
			stdout: "pipe",
		},
	);
	return result.exitCode === 0;
}

function runProcess(
	cmd: string[],
	cwd: string,
	allowExitCodeOne: boolean,
): string {
	const result = Bun.spawnSync(cmd, {
		cwd,
		env: gitProcessEnv(),
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

function resolveGitCommitSha(root: string, sha: string): string {
	try {
		return runGit(
			root,
			["rev-parse", "--verify", `${sha}^{commit}`],
			false,
		).trim();
	} catch {
		throw new Error(`Unknown commit: ${sha}`);
	}
}

function parseGitStatus(
	output: string,
	root: string,
	graph: BrowserGitGraph,
	ignoredGitPaths: readonly string[],
): BrowserGitInitializedResponse {
	const lines = output
		.split(/\r?\n/)
		.map((line) => line.trimEnd())
		.filter((line) => line !== "");
	const branchLine = lines.find((line) => line.startsWith("## "));
	const fileLines = lines.filter((line) => !line.startsWith("## "));

	const { ahead, behind, branch } = parseGitBranchStatusLine(branchLine);
	const hasHeadCommit = hasGitHeadCommit(root);

	const files = fileLines
		.map((line) => parseGitFileStatusLine(line))
		.filter((file): file is BrowserGitFileStatus => file !== undefined)
		.filter((file) => !isIgnoredGitPath(file.path, ignoredGitPaths))
		.map((file) => ({
			...file,
			...readGitFileLineCounts(root, file, hasHeadCommit),
		}));

	return {
		initialized: true,
		root,
		branch,
		ahead,
		behind,
		clean: files.length === 0,
		graph,
		files,
	};
}

function parseGitBranchStatusLine(branchLine: string | undefined): {
	ahead: number;
	behind: number;
	branch: string | null;
} {
	if (!branchLine) {
		return {
			ahead: 0,
			behind: 0,
			branch: null,
		};
	}

	const unbornMatch = branchLine.match(
		/^## (?:No commits yet on|Initial commit on) (.+)$/,
	);
	if (unbornMatch) {
		return {
			ahead: 0,
			behind: 0,
			branch: unbornMatch[1] ?? null,
		};
	}

	const aheadMatch = branchLine.match(/ahead (\d+)/);
	const behindMatch = branchLine.match(/behind (\d+)/);
	const summary = branchLine.slice(3).split("...")[0]?.trim() ?? "";
	return {
		ahead: Number(aheadMatch?.[1] ?? 0),
		behind: Number(behindMatch?.[1] ?? 0),
		branch: summary === "" || summary.startsWith("HEAD") ? null : summary,
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
	hasHeadCommit: boolean,
): { additions: number; deletions: number } {
	if (!hasHeadCommit) {
		if (file.indexStatus === "?" || file.worktreeStatus === "?") {
			return readUntrackedFileLineCounts(root, file.path);
		}

		const paths = file.renamedFrom
			? [file.renamedFrom, file.path]
			: [file.path];
		const stagedCounts = parseGitNumstatOutput(
			runGit(
				root,
				["diff", "--cached", "--numstat", "-M", "--", ...paths],
				false,
			),
		);
		const worktreeCounts = parseGitNumstatOutput(
			runGit(root, ["diff", "--numstat", "-M", "--", ...paths], false),
		);
		return sumGitNumstatCounts(stagedCounts, worktreeCounts);
	}

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
		return readUntrackedFileLineCounts(root, file.path);
	}

	return { additions: 0, deletions: 0 };
}

function readUntrackedFileLineCounts(
	root: string,
	path: string,
): { additions: number; deletions: number } {
	try {
		const absolutePath = resolveExistingPathWithinRoot(root, path);
		const untrackedOutput = runProcess(
			["git", "diff", "--no-index", "--numstat", "/dev/null", absolutePath],
			root,
			true,
		);
		return (
			parseGitNumstatOutput(untrackedOutput) ?? { additions: 0, deletions: 0 }
		);
	} catch (error) {
		if (error instanceof Error && error.message === "Path escapes agent home") {
			return { additions: 0, deletions: 0 };
		}
		throw error;
	}
}

function sumGitNumstatCounts(
	left: { additions: number; deletions: number } | undefined,
	right: { additions: number; deletions: number } | undefined,
): { additions: number; deletions: number } {
	return {
		additions: (left?.additions ?? 0) + (right?.additions ?? 0),
		deletions: (left?.deletions ?? 0) + (right?.deletions ?? 0),
	};
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

function isIgnoredGitPath(
	path: string,
	ignoredGitPaths: readonly string[],
): boolean {
	const normalizedPath = normalizeGitPaths([path])[0];
	if (!normalizedPath) {
		return false;
	}

	return ignoredGitPaths.some(
		(ignoredPath) =>
			normalizedPath === ignoredPath ||
			normalizedPath.startsWith(`${ignoredPath}/`),
	);
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
			env: gitProcessEnv(),
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
			env: gitProcessEnv(),
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

function toAgentTreeGitChanges(
	output: string,
	relativeAgentRoot: string,
	ignoredGitPaths: readonly string[],
): Map<string, BrowserFileGitChange> {
	const changes = new Map<string, BrowserFileGitChange>();
	const fileLines = output
		.split(/\r?\n/)
		.map((line) => line.trimEnd())
		.filter((line) => line !== "");

	for (const line of fileLines) {
		const fileStatus = parseGitFileStatusLine(line);
		if (!fileStatus) {
			continue;
		}
		if (isIgnoredGitPath(fileStatus.path, ignoredGitPaths)) {
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
		changes.set(
			path,
			mergeTreeEntryGitChange(changes.get(path), {
				path: fileStatus.path,
				status: gitStatus,
			}),
		);
	}

	return changes;
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

function mergeTreeEntryGitChange(
	current: BrowserFileGitChange | undefined,
	incoming: BrowserFileGitChange,
): BrowserFileGitChange {
	if (!current) {
		return incoming;
	}
	return {
		path: incoming.path,
		status: mergeTreeEntryGitStatus(current.status, incoming.status),
	};
}
