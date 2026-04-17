import { resolve, sep } from "node:path";
import type { BrowserSidebarInvalidatedEvent } from "../../common/protocol.ts";
import {
	startDirectoryWatch,
	type WatchFactory,
	type WatchFilename,
	type WatchHandle,
} from "../filesystem/directory-watch.ts";

interface WatchedAgentRoot {
	agentId: string;
	rootDir: string;
}

interface CreateBrowserSidebarWatcherOptions {
	agents: WatchedAgentRoot[];
	debounceMs?: number;
	gitRoot: string;
	onInvalidate: (event: BrowserSidebarInvalidatedEvent) => void;
	watchFactory?: WatchFactory;
}

const DEFAULT_DEBOUNCE_MS = 75;
const SECTION_ORDER = ["git", "tree", "cron"] as const;

function normalizePath(path: string): string {
	return resolve(path);
}

function isPathWithin(rootDir: string, candidatePath: string): boolean {
	const normalizedRoot = normalizePath(rootDir);
	const normalizedCandidate = normalizePath(candidatePath);
	return (
		normalizedCandidate === normalizedRoot ||
		normalizedCandidate.startsWith(`${normalizedRoot}${sep}`)
	);
}

function toAbsolutePath(
	rootDir: string,
	filename: WatchFilename,
): string | null {
	if (!filename) {
		return null;
	}
	return resolve(rootDir, String(filename));
}

function isCronPath(agentRoot: string, absolutePath: string): boolean {
	return isPathWithin(resolve(agentRoot, "cron"), absolutePath);
}

function sortSections(
	sections: Iterable<"tree" | "cron" | "git">,
): Array<"tree" | "cron" | "git"> {
	const nextSections = new Set(sections);
	return SECTION_ORDER.filter((section) => nextSections.has(section));
}

function queueSection(
	pendingByAgent: Map<string, Set<"tree" | "cron" | "git">>,
	agentId: string,
	sections: Array<"tree" | "cron" | "git">,
) {
	const pending = pendingByAgent.get(agentId) ?? new Set();
	for (const section of sections) {
		pending.add(section);
	}
	pendingByAgent.set(agentId, pending);
}

export function createBrowserSidebarWatcher(
	options: CreateBrowserSidebarWatcherOptions,
) {
	const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
	const normalizedGitRoot = normalizePath(options.gitRoot);
	const normalizedAgents = options.agents.map((agent) => ({
		agentId: agent.agentId,
		rootDir: normalizePath(agent.rootDir),
	}));
	const externalAgents = normalizedAgents.filter(
		(agent) => !isPathWithin(normalizedGitRoot, agent.rootDir),
	);
	const handles: WatchHandle[] = [];
	const pendingByAgent = new Map<string, Set<"tree" | "cron" | "git">>();
	let pendingGit = false;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const flush = () => {
		timer = undefined;

		if (pendingGit) {
			options.onInvalidate({
				type: "browser_sidebar_invalidated",
				sections: ["git"],
			});
			pendingGit = false;
		}

		for (const [agentId, sections] of pendingByAgent) {
			options.onInvalidate({
				type: "browser_sidebar_invalidated",
				agentId,
				sections: sortSections(sections),
			});
		}
		pendingByAgent.clear();
	};

	const scheduleFlush = () => {
		if (timer) {
			return;
		}
		timer = setTimeout(flush, debounceMs);
	};

	const handleGitRootChange = (filename: WatchFilename) => {
		const absolutePath = toAbsolutePath(normalizedGitRoot, filename);
		if (!absolutePath) {
			pendingGit = true;
			for (const agent of normalizedAgents) {
				if (!isPathWithin(normalizedGitRoot, agent.rootDir)) {
					continue;
				}
				queueSection(pendingByAgent, agent.agentId, ["tree", "cron"]);
			}
			scheduleFlush();
			return;
		}

		let matchedAgent = false;
		for (const agent of normalizedAgents) {
			if (!isPathWithin(agent.rootDir, absolutePath)) {
				continue;
			}
			matchedAgent = true;
			const sections: Array<"tree" | "cron" | "git"> = ["git", "tree"];
			if (isCronPath(agent.rootDir, absolutePath)) {
				sections.push("cron");
			}
			queueSection(pendingByAgent, agent.agentId, sections);
		}

		if (!matchedAgent) {
			pendingGit = true;
		}
		scheduleFlush();
	};

	const handleExternalAgentChange =
		(agent: { agentId: string; rootDir: string }) =>
		(filename: WatchFilename) => {
			const sections: Array<"tree" | "cron" | "git"> = ["tree"];
			if (
				filename === null ||
				isCronPath(agent.rootDir, toAbsolutePath(agent.rootDir, filename) ?? "")
			) {
				sections.push("cron");
			}
			queueSection(pendingByAgent, agent.agentId, sections);
			scheduleFlush();
		};

	const startWatching = (
		path: string,
		listener: (filename: WatchFilename) => void,
	) => {
		handles.push(
			startDirectoryWatch({
				errorLabel: "Browser sidebar watcher",
				path,
				recursive: true,
				watchFactory: options.watchFactory,
				onChange: listener,
			}),
		);
	};

	return {
		start() {
			if (handles.length > 0) {
				return;
			}

			startWatching(normalizedGitRoot, handleGitRootChange);
			for (const agent of externalAgents) {
				startWatching(agent.rootDir, handleExternalAgentChange(agent));
			}
		},
		stop() {
			for (const handle of handles.splice(0)) {
				handle.close();
			}
			if (!timer) {
				return;
			}
			clearTimeout(timer);
			timer = undefined;
		},
	};
}
