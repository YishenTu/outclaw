import {
	BookText,
	ChevronDown,
	ChevronRight,
	FileCode2,
	FileImage,
	FileJson2,
	FileText,
	Folder,
} from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import type { BrowserTreeEntry } from "../../../../common/protocol.ts";
import { treeEntryToneClass } from "./git-status-tone.ts";

interface FileTreeProps {
	agentId: string;
	entries: BrowserTreeEntry[];
	onOpenFile: (params: { agentId: string; path: string }) => void;
}

export function isTreeNodeExpanded(
	expandedPaths: Record<string, boolean>,
	path: string,
): boolean {
	return expandedPaths[path] ?? false;
}

export function treeNodePaddingLeft(depth: number): string {
	return `${depth * 18 + 12}px`;
}

export function fileNodePaddingLeft(depth: number): string {
	return `${depth * 18 + 34}px`;
}

export function fileKindForPath(path: string) {
	const lowerPath = path.toLowerCase();
	if (lowerPath.endsWith(".md")) {
		return "markdown";
	}
	if (lowerPath.endsWith(".json")) {
		return "json";
	}
	if (
		lowerPath.endsWith(".ts") ||
		lowerPath.endsWith(".tsx") ||
		lowerPath.endsWith(".js") ||
		lowerPath.endsWith(".jsx") ||
		lowerPath.endsWith(".css") ||
		lowerPath.endsWith(".html") ||
		lowerPath.endsWith(".yaml") ||
		lowerPath.endsWith(".yml") ||
		lowerPath.endsWith(".sh")
	) {
		return "code";
	}
	if (
		lowerPath.endsWith(".png") ||
		lowerPath.endsWith(".jpg") ||
		lowerPath.endsWith(".jpeg") ||
		lowerPath.endsWith(".gif") ||
		lowerPath.endsWith(".webp") ||
		lowerPath.endsWith(".svg")
	) {
		return "image";
	}
	return "default";
}

export { treeEntryToneClass } from "./git-status-tone.ts";

function FileIcon({ path }: { path: string }) {
	switch (fileKindForPath(path)) {
		case "markdown":
			return <BookText size={14} className="shrink-0" />;
		case "json":
			return <FileJson2 size={14} className="shrink-0" />;
		case "code":
			return <FileCode2 size={14} className="shrink-0" />;
		case "image":
			return <FileImage size={14} className="shrink-0" />;
		default:
			return <FileText size={14} className="shrink-0" />;
	}
}

export function FileTreeHeader({ agentName }: { agentName?: string | null }) {
	const path = agentName
		? `~/.outclaw/agents/${agentName}`
		: "~/.outclaw/agents/";
	return (
		<div className="h-8 shrink-0 border-b border-dark-800 px-3">
			<div className="flex h-full items-center px-1">
				<div className="font-mono-ui truncate text-[11px] uppercase tracking-[0.16em] text-dark-500">
					{path}
				</div>
			</div>
		</div>
	);
}

export function FileTree({ agentId, entries, onOpenFile }: FileTreeProps) {
	const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>(
		{},
	);
	const visibleEntries = useMemo(() => entries, [entries]);

	return (
		<div className="space-y-0.5 px-3 py-3">
			{visibleEntries.map((entry) => (
				<TreeNode
					key={entry.path}
					agentId={agentId}
					depth={0}
					entry={entry}
					expandedPaths={expandedPaths}
					onOpenFile={onOpenFile}
					onToggle={(path) =>
						setExpandedPaths((current) => ({
							...current,
							[path]: !current[path],
						}))
					}
				/>
			))}
		</div>
	);
}

interface TreeNodeProps {
	agentId: string;
	depth: number;
	entry: BrowserTreeEntry;
	expandedPaths: Record<string, boolean>;
	onOpenFile: (params: { agentId: string; path: string }) => void;
	onToggle: (path: string) => void;
}

function TreeNode({
	agentId,
	depth,
	entry,
	expandedPaths,
	onOpenFile,
	onToggle,
}: TreeNodeProps) {
	if (entry.kind === "file") {
		return (
			<button
				type="button"
				onClick={() => onOpenFile({ agentId, path: entry.path })}
				className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm transition-colors hover:bg-dark-900 ${treeEntryToneClass(entry)}`}
				style={{ paddingLeft: fileNodePaddingLeft(depth) }}
			>
				<FileIcon path={entry.path} />
				<span className="truncate">{entry.name}</span>
			</button>
		);
	}

	const expanded = isTreeNodeExpanded(expandedPaths, entry.path);
	return (
		<Fragment>
			<button
				type="button"
				onClick={() => onToggle(entry.path)}
				className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm transition-colors hover:bg-dark-900 ${treeEntryToneClass(entry)}`}
				style={{ paddingLeft: treeNodePaddingLeft(depth) }}
			>
				{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
				<Folder size={14} className="shrink-0" />
				<span className="truncate">{entry.name}</span>
			</button>
			{expanded &&
				entry.children?.map((child) => (
					<TreeNode
						key={child.path}
						agentId={agentId}
						depth={depth + 1}
						entry={child}
						expandedPaths={expandedPaths}
						onOpenFile={onOpenFile}
						onToggle={onToggle}
					/>
				))}
		</Fragment>
	);
}
