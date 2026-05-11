import type { GitStatusEntry } from "@pierre/trees";
import { FileTree as PierreFileTree, useFileTree } from "@pierre/trees/react";
import { FolderTree, Network } from "lucide-react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { useEffect, useMemo, useRef } from "react";
import type { BrowserTreeEntry } from "../../../../common/protocol.ts";

// Maps the outclaw browser palette (defined in index.css) onto Pierre's
// `--trees-*-override` surface so the file tree blends with the rest of the
// right panel instead of using Pierre's defaults. Pierre reads `*-override`
// vars via `var(..., fallback)`, so we only need to set the ones we care
// about. Hex colors stay as hex; tokens defined as `R G B` triples are wrapped
// in `rgb(...)` to materialize a real color.
const fileTreeThemeStyle: CSSProperties = {
	height: "100%",
	"--trees-bg-override": "var(--dark-950)",
	"--trees-bg-muted-override": "var(--dark-900)",
	// Match the previous default item color (`text-dark-400` from the old
	// treeEntryToneClass) — dark-100 was too bright against the dark-950 panel.
	"--trees-fg-override": "var(--dark-400)",
	"--trees-fg-muted-override": "var(--dark-500)",
	"--trees-border-color-override": "var(--dark-800)",
	"--trees-selected-bg-override": "var(--dark-800)",
	"--trees-selected-fg-override": "var(--dark-100)",
	"--trees-selected-focused-border-color-override": "rgb(var(--brand))",
	"--trees-accent-override": "rgb(var(--brand))",
	"--trees-focus-ring-color-override": "rgb(var(--brand))",
	"--trees-indent-guide-bg-override": "var(--dark-800)",
	"--trees-scrollbar-thumb-override": "var(--dark-700)",
	"--trees-input-bg-override": "var(--dark-900)",
	"--trees-search-bg-override": "var(--dark-900)",
	"--trees-search-fg-override": "var(--dark-100)",
	"--trees-font-family-override":
		'"IBM Plex Sans", "Inter", "Segoe UI", sans-serif',
	// Match Tailwind `text-sm` used by git-panel.tsx file rows (Pierre default
	// is 13px, which read 1px denser than the surrounding panel surfaces).
	"--trees-font-size-override": "14px",
	// Git status — aligned with `gitPanelFileToneClass` so the file tree and
	// the git panel use one palette: modified = warning amber (the panel
	// deliberately uses warning over brand — see the `--warning` comment in
	// index.css), new/added = success, deleted = danger, renamed = info,
	// ignored = dark-500. Set both `git-*` and `status-*` so every Pierre
	// code path that reads either family lands on the same color.
	"--trees-git-modified-color-override": "rgb(var(--warning))",
	"--trees-git-untracked-color-override": "rgb(var(--success))",
	"--trees-git-added-color-override": "rgb(var(--success))",
	"--trees-git-deleted-color-override": "rgb(var(--danger))",
	"--trees-git-renamed-color-override": "rgb(var(--info))",
	"--trees-git-ignored-color-override": "var(--dark-500)",
	"--trees-status-modified-override": "rgb(var(--warning))",
	"--trees-status-untracked-override": "rgb(var(--success))",
	"--trees-status-added-override": "rgb(var(--success))",
	"--trees-status-deleted-override": "rgb(var(--danger))",
	"--trees-status-renamed-override": "rgb(var(--info))",
	"--trees-status-ignored-override": "var(--dark-500)",
} as CSSProperties;

interface FileTreeProps {
	agentId: string;
	entries: BrowserTreeEntry[];
	onOpenFile: (params: { agentId: string; path: string }) => void;
}

export type FilesViewMode = "tree" | "graph";

function normalizeDirectoryStatusPath(path: string): string {
	return path.endsWith("/") ? path : `${path}/`;
}

function pierreGitStatus(
	entry: BrowserTreeEntry,
): GitStatusEntry["status"] | undefined {
	if (entry.gitStatus === "modified") {
		return "modified";
	}
	if (entry.gitStatus === "new") {
		return "untracked";
	}
	return undefined;
}

export function flattenBrowserTreePaths(entries: BrowserTreeEntry[]): string[] {
	const paths: string[] = [];

	for (const entry of entries) {
		if (entry.kind === "file") {
			paths.push(entry.path);
			continue;
		}
		if (entry.children) {
			paths.push(...flattenBrowserTreePaths(entry.children));
		}
	}

	return paths;
}

export function browserTreeGitStatusEntries(
	entries: BrowserTreeEntry[],
): GitStatusEntry[] {
	const gitStatusEntries: GitStatusEntry[] = [];

	for (const entry of entries) {
		const status = pierreGitStatus(entry);
		if (status) {
			gitStatusEntries.push({
				path:
					entry.kind === "directory"
						? normalizeDirectoryStatusPath(entry.path)
						: entry.path,
				status,
			});
		}
		if (entry.children) {
			gitStatusEntries.push(...browserTreeGitStatusEntries(entry.children));
		}
	}

	return gitStatusEntries;
}

export function FileTreeHeader({
	agentName,
	viewMode,
	onToggleViewMode,
}: {
	agentName?: string | null;
	viewMode?: FilesViewMode;
	onToggleViewMode?: () => void;
}) {
	const path = agentName
		? `~/.outclaw/agents/${agentName}`
		: "~/.outclaw/agents/";
	const showToggle = Boolean(viewMode && onToggleViewMode);
	const nextLabel = viewMode === "graph" ? "Show file tree" : "Show graph view";
	return (
		<div className="h-8 shrink-0 border-b border-dark-800 px-3">
			<div className="flex h-full items-center gap-2 px-1">
				<div className="font-mono-ui min-w-0 flex-1 truncate text-[11px] uppercase tracking-[0.16em] text-dark-500">
					{path}
				</div>
				{showToggle ? (
					<button
						type="button"
						onClick={onToggleViewMode}
						aria-label={nextLabel}
						title={nextLabel}
						className="flex items-center justify-center text-dark-500 transition-colors hover:text-dark-100"
					>
						{viewMode === "graph" ? (
							<FolderTree size={13} />
						) : (
							<Network size={13} />
						)}
					</button>
				) : null}
			</div>
		</div>
	);
}

function clickedFilePath(event: ReactMouseEvent<HTMLElement>): string | null {
	const path = event.nativeEvent.composedPath();

	for (const target of path) {
		if (!(target instanceof HTMLElement)) {
			continue;
		}
		if (target.dataset.itemType === "file" && target.dataset.itemPath) {
			return target.dataset.itemPath;
		}
	}

	return null;
}

export function FileTree({ agentId, entries, onOpenFile }: FileTreeProps) {
	const paths = useMemo(() => flattenBrowserTreePaths(entries), [entries]);
	const gitStatusEntries = useMemo(
		() => browserTreeGitStatusEntries(entries),
		[entries],
	);
	const latestAgentId = useRef(agentId);
	const latestOnOpenFile = useRef(onOpenFile);
	latestAgentId.current = agentId;
	latestOnOpenFile.current = onOpenFile;
	const { model } = useFileTree({
		gitStatus: gitStatusEntries,
		initialExpansion: "closed",
		paths,
	});

	useEffect(() => {
		model.resetPaths(paths);
	}, [model, paths]);

	useEffect(() => {
		model.setGitStatus(gitStatusEntries);
	}, [model, gitStatusEntries]);

	return (
		<PierreFileTree
			model={model}
			className="block h-full min-h-0"
			onClick={(event) => {
				const path = clickedFilePath(event);
				if (!path) {
					return;
				}
				latestOnOpenFile.current({ agentId: latestAgentId.current, path });
			}}
			style={fileTreeThemeStyle}
		/>
	);
}
