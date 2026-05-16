import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { listWorkspaceFiles } from "./list-workspace-files.ts";

export interface AgentGraphNode {
	id: string;
	name: string;
	path: string | null;
	resolved: boolean;
}

export interface AgentGraphLink {
	source: string;
	target: string;
}

export interface AgentGraph {
	nodes: AgentGraphNode[];
	links: AgentGraphLink[];
}

const MARKDOWN_FILE_LIMIT = 5000;
const FENCED_CODE_PATTERN = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
const INLINE_CODE_PATTERN = /`[^`\n]*`/g;
// Indented code blocks: 4+ leading spaces or a tab on a non-blank line. Done
// per-line (multiline regex flag) so we do not gobble unrelated content.
const INDENTED_CODE_LINE_PATTERN = /^(?: {4}|\t).*$/gm;
const WIKILINK_PATTERN =
	/\[\[([^[\]\n|#^]+)(?:#[^[\]\n|]*)?(?:\|[^[\]\n]*)?\]\]/g;

interface FileLinkCacheEntry {
	mtimeMs: number;
	targets: string[];
}

// Module-level cache keyed by rootDir. Each entry stores a per-file (mtime,
// parsed targets) pair. On every call we stat each markdown file, reuse the
// cached parse if mtime matches, else re-read and update. Stale entries (file
// removed) are pruned.
const linkCacheByRoot = new Map<string, Map<string, FileLinkCacheEntry>>();

interface BuildAgentGraphOptions {
	ignoredNames?: readonly string[];
}

/**
 * Reset the wikilink parse cache. Mostly for tests; production callers should
 * not need this because mtime invalidation handles updates.
 */
export function clearAgentGraphCache(): void {
	linkCacheByRoot.clear();
}

export async function buildAgentGraph(
	rootDir: string,
	options: BuildAgentGraphOptions = {},
): Promise<AgentGraph> {
	const entries = await listWorkspaceFiles(rootDir, {
		ignoredNames: options.ignoredNames,
		limit: MARKDOWN_FILE_LIMIT,
	});
	const markdownPaths = entries
		.filter(
			(entry) =>
				entry.kind === "file" && entry.path.toLowerCase().endsWith(".md"),
		)
		.map((entry) => entry.path);

	// Index files by basename (lowercased, no extension) for wikilink resolution.
	const basenameIndex = new Map<string, string>();
	for (const path of markdownPaths) {
		const key = basename(path, ".md").toLowerCase();
		// First-wins: stable resolution, prefers the alphabetically earliest path
		// because listWorkspaceFiles already sorts by path.
		if (!basenameIndex.has(key)) {
			basenameIndex.set(key, path);
		}
	}

	const nodes = new Map<string, AgentGraphNode>();
	for (const path of markdownPaths) {
		nodes.set(path, {
			id: path,
			name: basename(path, ".md"),
			path,
			resolved: true,
		});
	}

	const cache = getOrCreateRootCache(rootDir);
	const seenPaths = new Set<string>();

	const links: AgentGraphLink[] = [];
	for (const path of markdownPaths) {
		seenPaths.add(path);
		const targets = await readTargetsCached(rootDir, path, cache);
		for (const targetText of targets) {
			const key = targetText.trim().toLowerCase();
			if (key === "") {
				continue;
			}
			const resolvedPath = basenameIndex.get(key);
			if (resolvedPath) {
				links.push({ source: path, target: resolvedPath });
				continue;
			}
			const unresolvedId = `unresolved:${key}`;
			if (!nodes.has(unresolvedId)) {
				nodes.set(unresolvedId, {
					id: unresolvedId,
					name: targetText.trim(),
					path: null,
					resolved: false,
				});
			}
			links.push({ source: path, target: unresolvedId });
		}
	}

	// Drop cache entries for files that no longer exist so memory does not grow
	// unboundedly across long-running sessions.
	for (const cachedPath of cache.keys()) {
		if (!seenPaths.has(cachedPath)) {
			cache.delete(cachedPath);
		}
	}

	return {
		nodes: Array.from(nodes.values()),
		links,
	};
}

function getOrCreateRootCache(
	rootDir: string,
): Map<string, FileLinkCacheEntry> {
	let cache = linkCacheByRoot.get(rootDir);
	if (!cache) {
		cache = new Map();
		linkCacheByRoot.set(rootDir, cache);
	}
	return cache;
}

async function readTargetsCached(
	rootDir: string,
	relativePath: string,
	cache: Map<string, FileLinkCacheEntry>,
): Promise<string[]> {
	const absolutePath = resolve(rootDir, relativePath);
	let mtimeMs: number;
	try {
		const stats = await stat(absolutePath);
		mtimeMs = stats.mtimeMs;
	} catch {
		return [];
	}
	const cached = cache.get(relativePath);
	if (cached && cached.mtimeMs === mtimeMs) {
		return cached.targets;
	}
	let raw: string;
	try {
		raw = await readFile(absolutePath, "utf8");
	} catch {
		return [];
	}
	const stripped = stripCodeRegions(raw);
	const targets = Array.from(extractWikilinkTargets(stripped));
	cache.set(relativePath, { mtimeMs, targets });
	return targets;
}

function stripCodeRegions(text: string): string {
	// Order matters: fenced first (handles multi-line ``` blocks containing
	// indented lines), then indented lines, finally inline single-line spans.
	return text
		.replace(FENCED_CODE_PATTERN, "")
		.replace(INDENTED_CODE_LINE_PATTERN, "")
		.replace(INLINE_CODE_PATTERN, "");
}

function* extractWikilinkTargets(text: string): IterableIterator<string> {
	WIKILINK_PATTERN.lastIndex = 0;
	let match: RegExpExecArray | null = WIKILINK_PATTERN.exec(text);
	while (match !== null) {
		yield match[1] ?? "";
		match = WIKILINK_PATTERN.exec(text);
	}
}
