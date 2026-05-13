import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import type {
	BrowserFileGitChange,
	BrowserGitCommitFileChangeType,
	BrowserGitCommitFileStat,
	BrowserGitCommitResponse,
	BrowserGitCommitStats,
	BrowserGitDiffResponse,
	BrowserGitFileStatus,
	BrowserGitHistory,
	BrowserGitHistoryCommit,
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
import { gitExcludePathspecsForPaths } from "./pathspec.ts";

const MAX_GIT_HISTORY_COMMITS = 30;
const MAX_GIT_HISTORY_PAGE_SIZE = 100;
const MAX_GIT_NUMSTAT_PATHS_PER_BATCH = 200;

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
		[
			"status",
			"--porcelain=v1",
			"--branch",
			"--untracked-files=all",
			...gitStatusPathspecArgs(".", ignoredGitPaths),
		],
		false,
	);
	return parseGitStatus(
		output,
		gitRoot,
		readGitHistory(gitRoot),
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

export function readGitCommitStats(
	root: string,
	sha: string,
): BrowserGitCommitStats {
	const { parentSha, resolvedSha } = readCommitIdentity(root, sha);
	const statsArgs: string[] =
		parentSha === undefined
			? [
					"show",
					"-z",
					"--raw",
					"--numstat",
					"--no-ext-diff",
					"--format=",
					resolvedSha,
				]
			: [
					"diff",
					"-z",
					"--raw",
					"--numstat",
					"--no-ext-diff",
					parentSha,
					resolvedSha,
				];

	const { numstatByPath, statusByPath } = parseGitRawNumstatZ(
		runGit(root, statsArgs, false),
	);

	const files: BrowserGitCommitFileStat[] = [];
	let totalAdditions = 0;
	let totalDeletions = 0;
	for (const [path, status] of statusByPath) {
		const stat = numstatByPath.get(path) ?? {
			additions: 0,
			deletions: 0,
			binary: false,
		};
		files.push({
			path,
			change: status.change,
			renamedFrom: status.renamedFrom,
			additions: stat.additions,
			deletions: stat.deletions,
			binary: stat.binary,
		});
		totalAdditions += stat.additions;
		totalDeletions += stat.deletions;
	}

	return {
		sha: resolvedSha,
		files,
		totalAdditions,
		totalDeletions,
	};
}

function readCommitIdentity(
	root: string,
	sha: string,
): { parentSha?: string; resolvedSha: string } {
	let metadata: string;
	try {
		metadata = runGit(
			root,
			["show", "--no-patch", "--format=%H%x1f%P", sha],
			false,
		).trim();
	} catch {
		throw new Error(`Unknown commit: ${sha}`);
	}
	const [resolvedSha, parentsValue] = metadata.split("\x1f");
	if (!resolvedSha || parentsValue === undefined) {
		throw new Error(`Failed to parse commit metadata: ${sha}`);
	}
	const parentSha = parentsValue.split(" ").find((parent) => parent !== "");
	return {
		resolvedSha,
		...(parentSha ? { parentSha } : {}),
	};
}

interface GitNumstatEntry {
	additions: number;
	deletions: number;
	binary: boolean;
}

function parseGitRawNumstatZ(output: string): {
	numstatByPath: Map<string, GitNumstatEntry>;
	statusByPath: Map<string, GitNameStatusEntry>;
} {
	const fields = output.split("\0");
	let index = 0;
	const statusByPath = new Map<string, GitNameStatusEntry>();
	while (index < fields.length) {
		const head = fields[index];
		if (head === undefined || head === "") {
			index += 1;
			continue;
		}
		if (!head.startsWith(":")) {
			break;
		}
		const status = parseGitRawStatusHeader(head);
		if (!status) {
			index += 1;
			continue;
		}
		if (status.change === "renamed" || status.change === "copied") {
			const oldPath = fields[index + 1];
			const newPath = fields[index + 2];
			if (newPath !== undefined && newPath !== "") {
				statusByPath.set(newPath, {
					change: status.change,
					renamedFrom: oldPath,
				});
			}
			index += 3;
			continue;
		}
		const path = fields[index + 1];
		if (path !== undefined && path !== "") {
			statusByPath.set(path, { change: status.change });
		}
		index += 2;
	}

	return {
		numstatByPath: parseGitNumstatFields(fields, index),
		statusByPath,
	};
}

function parseGitRawStatusHeader(
	head: string,
): { change: BrowserGitCommitFileChangeType } | undefined {
	const statusToken = head.split(" ").at(-1);
	const change = mapGitStatusCode(statusToken?.[0]);
	return change ? { change } : undefined;
}

function parseGitNumstatFields(
	fields: string[],
	startIndex: number,
): Map<string, GitNumstatEntry> {
	const result = new Map<string, GitNumstatEntry>();
	let index = startIndex;
	while (index < fields.length) {
		const head = fields[index];
		if (head === undefined || head === "") {
			index += 1;
			continue;
		}
		const parts = head.split("\t");
		if (parts.length < 3) {
			index += 1;
			continue;
		}
		const [addedRaw, deletedRaw, inlinePath] = parts;
		if (addedRaw === undefined || deletedRaw === undefined) {
			index += 1;
			continue;
		}
		const additions = addedRaw === "-" ? 0 : Number.parseInt(addedRaw, 10);
		const deletions = deletedRaw === "-" ? 0 : Number.parseInt(deletedRaw, 10);
		const binary = addedRaw === "-" || deletedRaw === "-";
		const entry: GitNumstatEntry = {
			additions: Number.isFinite(additions) ? additions : 0,
			deletions: Number.isFinite(deletions) ? deletions : 0,
			binary,
		};
		if (inlinePath !== undefined && inlinePath !== "") {
			result.set(inlinePath, entry);
			index += 1;
			continue;
		}
		const newPath = fields[index + 2];
		if (newPath !== undefined && newPath !== "") {
			result.set(newPath, entry);
		}
		index += 3;
	}
	return result;
}

interface GitNameStatusEntry {
	change: BrowserGitCommitFileChangeType;
	renamedFrom?: string;
}

function mapGitStatusCode(
	code: string | undefined,
): BrowserGitCommitFileChangeType | undefined {
	switch (code) {
		case "A":
			return "added";
		case "M":
			return "modified";
		case "D":
			return "deleted";
		case "R":
			return "renamed";
		case "C":
			return "copied";
		case "T":
			return "type-changed";
		default:
			return undefined;
	}
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
				...gitStatusPathspecArgs(
					relativeAgentRoot === "" ? "." : relativeAgentRoot,
					ignoredGitPaths,
				),
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
	history: BrowserGitHistory,
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
		.filter((file) => !isIgnoredGitPath(file.path, ignoredGitPaths));
	const lineCounts = readGitLineCounts(root, files, hasHeadCommit);

	return {
		initialized: true,
		root,
		branch,
		ahead,
		behind,
		clean: files.length === 0,
		history,
		files: files.map((file) => ({
			...file,
			...(lineCounts.get(file.path) ?? { additions: 0, deletions: 0 }),
		})),
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

function readGitLineCounts(
	root: string,
	files: BrowserGitFileStatus[],
	hasHeadCommit: boolean,
): Map<string, { additions: number; deletions: number }> {
	const counts = new Map<string, { additions: number; deletions: number }>();
	if (files.length === 0) {
		return counts;
	}

	const { trackedFiles, untrackedFiles } = partitionGitFiles(files);
	if (!hasHeadCommit) {
		const stagedCounts = readBatchedGitNumstat(
			root,
			["diff", "--cached", "--numstat", "-M", "--"],
			trackedFiles,
		);
		const worktreeCounts = readBatchedGitNumstat(
			root,
			["diff", "--numstat", "-M", "--"],
			trackedFiles,
		);
		for (const file of trackedFiles) {
			counts.set(
				file.path,
				sumGitNumstatCounts(
					getGitNumstatCount(stagedCounts, file),
					getGitNumstatCount(worktreeCounts, file),
				),
			);
		}

		for (const file of untrackedFiles) {
			counts.set(file.path, readUntrackedFileLineCounts(root, file.path));
		}
		return counts;
	}

	const trackedCounts = readBatchedGitNumstat(
		root,
		["diff", "--numstat", "-M", "HEAD", "--"],
		trackedFiles,
	);
	for (const file of files) {
		if (isUntrackedGitFile(file)) {
			counts.set(file.path, readUntrackedFileLineCounts(root, file.path));
			continue;
		}

		counts.set(
			file.path,
			getGitNumstatCount(trackedCounts, file) ?? { additions: 0, deletions: 0 },
		);
	}

	return counts;
}

function partitionGitFiles(files: BrowserGitFileStatus[]): {
	trackedFiles: BrowserGitFileStatus[];
	untrackedFiles: BrowserGitFileStatus[];
} {
	const trackedFiles: BrowserGitFileStatus[] = [];
	const untrackedFiles: BrowserGitFileStatus[] = [];
	for (const file of files) {
		if (isUntrackedGitFile(file)) {
			untrackedFiles.push(file);
			continue;
		}
		trackedFiles.push(file);
	}
	return { trackedFiles, untrackedFiles };
}

function readBatchedGitNumstat(
	root: string,
	args: string[],
	files: BrowserGitFileStatus[],
): Map<string, { additions: number; deletions: number }> {
	const paths = uniqueGitDiffPaths(files);
	if (paths.length === 0) {
		return new Map();
	}

	const result = new Map<string, { additions: number; deletions: number }>();
	for (
		let index = 0;
		index < paths.length;
		index += MAX_GIT_NUMSTAT_PATHS_PER_BATCH
	) {
		const pathBatch = paths.slice(
			index,
			index + MAX_GIT_NUMSTAT_PATHS_PER_BATCH,
		);
		for (const [path, count] of parseGitNumstatMap(
			runGit(root, [...args, ...pathBatch], false),
		)) {
			result.set(path, count);
		}
	}
	return result;
}

function uniqueGitDiffPaths(files: BrowserGitFileStatus[]): string[] {
	const paths = new Set<string>();
	for (const file of files) {
		if (file.renamedFrom) {
			paths.add(file.renamedFrom);
		}
		paths.add(file.path);
	}
	return [...paths];
}

function isUntrackedGitFile(file: BrowserGitFileStatus): boolean {
	return file.indexStatus === "?" || file.worktreeStatus === "?";
}

function getGitNumstatCount(
	counts: ReadonlyMap<string, { additions: number; deletions: number }>,
	file: BrowserGitFileStatus,
): { additions: number; deletions: number } | undefined {
	const pathCount = counts.get(file.path);
	if (!file.renamedFrom || file.renamedFrom === file.path) {
		return pathCount;
	}

	return sumGitNumstatCounts(pathCount, counts.get(file.renamedFrom));
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
	const counts = [...parseGitNumstatMap(output).values()];
	if (counts.length === 0) {
		return undefined;
	}

	return counts.reduce(sumGitNumstatCounts, { additions: 0, deletions: 0 });
}

function parseGitNumstatMap(
	output: string,
): Map<string, { additions: number; deletions: number }> {
	const result = new Map<string, { additions: number; deletions: number }>();
	for (const line of output
		.split(/\r?\n/)
		.map((line) => line.trimEnd())
		.filter((line) => line !== "")) {
		const [rawAdditions, rawDeletions, ...pathParts] = line.split("\t");
		const rawPath = pathParts.join("\t");
		if (!rawPath) {
			continue;
		}
		result.set(resolveGitNumstatPath(rawPath), {
			additions: parseGitNumstatCount(rawAdditions),
			deletions: parseGitNumstatCount(rawDeletions),
		});
	}
	return result;
}

function resolveGitNumstatPath(rawPath: string): string {
	const arrowIndex = rawPath.indexOf(" => ");
	if (arrowIndex === -1) {
		return rawPath;
	}

	const braceStart = rawPath.lastIndexOf("{", arrowIndex);
	const braceEnd = rawPath.indexOf("}", arrowIndex);
	if (braceStart !== -1 && braceEnd !== -1) {
		return `${rawPath.slice(0, braceStart)}${rawPath.slice(
			arrowIndex + 4,
			braceEnd,
		)}${rawPath.slice(braceEnd + 1)}`;
	}

	return rawPath.slice(arrowIndex + 4);
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

function gitStatusPathspecArgs(
	rootPathspec: string,
	ignoredGitPaths: readonly string[],
): string[] {
	const ignoredPathspecs = gitExcludePathspecsForPaths(
		normalizeGitPaths(ignoredGitPaths),
	);
	return ["--", rootPathspec, ...ignoredPathspecs];
}

export function readGitHistory(
	root: string,
	options: { cursor?: string; limit?: number } = {},
): BrowserGitHistory {
	const limit = normalizeGitHistoryLimit(options.limit);
	const offset = parseGitHistoryCursor(options.cursor);
	const commits = readGitHistoryCommits(root, {
		limit: limit + 1,
		offset,
	});
	return {
		commits: commits.slice(0, limit),
		...(commits.length > limit ? { nextCursor: String(offset + limit) } : {}),
	};
}

function normalizeGitHistoryLimit(limit: number | undefined): number {
	if (limit === undefined) {
		return MAX_GIT_HISTORY_COMMITS;
	}
	if (!Number.isInteger(limit) || limit <= 0) {
		throw new Error("Invalid git history limit");
	}
	return Math.min(limit, MAX_GIT_HISTORY_PAGE_SIZE);
}

function parseGitHistoryCursor(cursor: string | undefined): number {
	if (cursor === undefined || cursor === "") {
		return 0;
	}
	if (!/^\d+$/.test(cursor)) {
		throw new Error("Invalid git history cursor");
	}
	const offset = Number.parseInt(cursor, 10);
	if (!Number.isSafeInteger(offset)) {
		throw new Error("Invalid git history cursor");
	}
	return offset;
}

function readGitHistoryCommits(
	root: string,
	options: { limit: number; offset: number },
): BrowserGitHistoryCommit[] {
	const result = Bun.spawnSync(
		[
			"git",
			"log",
			"--branches",
			"--tags",
			"--remotes",
			`--max-count=${options.limit}`,
			`--skip=${options.offset}`,
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
		.map((line) => parseGitHistoryCommitLine(line))
		.filter(
			(commit): commit is BrowserGitHistoryCommit => commit !== undefined,
		);
}

function parseGitHistoryCommitLine(
	line: string,
): BrowserGitHistoryCommit | undefined {
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
