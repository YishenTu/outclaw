import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	normalizeWatchFilename,
	startDirectoryWatch,
	type WatchFactory,
} from "../filesystem/directory-watch.ts";
import { refreshMemoryIndex } from "./memory-index-refresh.ts";

const DEFAULT_DEBOUNCE_MS = 75;
const SCHEMAS_DIR = "schemas";
const SCHEMA_INDEX_FILE = "index.md";

export interface MemoryIndexWatcherOptions {
	memoryRoot: string;
	debounceMs?: number;
	refresh?: (memoryRoot: string) => void;
	onError?: (error: unknown) => void;
	watchFactory?: WatchFactory;
}

export interface MemoryIndexWatcherHandle {
	stop(): void;
}

export function startMemoryIndexWatcher(
	options: MemoryIndexWatcherOptions,
): MemoryIndexWatcherHandle {
	const refresh = options.refresh ?? defaultRefresh;
	const onError = options.onError ?? defaultOnError;
	const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const runRefresh = () => {
		try {
			refresh(options.memoryRoot);
		} catch (error) {
			onError(error);
		}
	};

	const scheduleRefresh = () => {
		if (timer) {
			return;
		}
		timer = setTimeout(() => {
			timer = undefined;
			runRefresh();
		}, debounceMs);
	};

	runRefresh();

	const schemasPath = join(options.memoryRoot, SCHEMAS_DIR);
	if (!existsSync(schemasPath)) {
		return {
			stop() {},
		};
	}

	const handle = startDirectoryWatch({
		errorLabel: "Memory index watcher",
		path: schemasPath,
		recursive: false,
		watchFactory: options.watchFactory,
		onChange: (filename) => {
			if (!isRelevantMemoryIndexChange(normalizeWatchFilename(filename))) {
				return;
			}
			scheduleRefresh();
		},
	});

	return {
		stop() {
			handle.close();
			if (!timer) {
				return;
			}
			clearTimeout(timer);
			timer = undefined;
		},
	};
}

function defaultRefresh(memoryRoot: string): void {
	refreshMemoryIndex({ memoryRoot });
}

function defaultOnError(error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`[memory-index] refresh failed: ${message}`);
}

function isRelevantMemoryIndexChange(filename: string | undefined): boolean {
	if (!filename) {
		return true;
	}

	const normalized = filename.replaceAll("\\", "/");
	if (normalized === SCHEMA_INDEX_FILE) {
		return false;
	}
	return normalized.endsWith(".md");
}
