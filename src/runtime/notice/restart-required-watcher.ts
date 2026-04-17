import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	normalizeWatchFilename,
	startDirectoryWatch,
	type WatchFactory,
	type WatchHandle,
} from "../filesystem/directory-watch.ts";

interface CreateRestartRequiredWatcherOptions {
	debounceMs?: number;
	homeDir: string;
	onRestartRequired: () => void;
	watchFactory?: WatchFactory;
}

const DEFAULT_DEBOUNCE_MS = 75;

function isRelevantHomeChange(filename: string | undefined): boolean {
	return (
		filename === "config.json" || filename === ".env" || filename === "agents"
	);
}

export function createRestartRequiredWatcher(
	options: CreateRestartRequiredWatcherOptions,
) {
	const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
	const configPath = join(options.homeDir, "config.json");
	const envPath = join(options.homeDir, ".env");
	const agentsDir = join(options.homeDir, "agents");
	const handles: WatchHandle[] = [];
	let timer: ReturnType<typeof setTimeout> | undefined;

	const trigger = () => {
		if (timer) {
			return;
		}
		timer = setTimeout(() => {
			timer = undefined;
			options.onRestartRequired();
		}, debounceMs);
	};

	const startWatching = (
		path: string,
		listener: (filename: string | undefined) => void,
	) => {
		handles.push(
			startDirectoryWatch({
				errorLabel: "Restart required watcher",
				path,
				recursive: false,
				watchFactory: options.watchFactory,
				onChange: (filename) => {
					listener(normalizeWatchFilename(filename));
				},
			}),
		);
	};

	return {
		start() {
			if (handles.length > 0) {
				return;
			}

			startWatching(options.homeDir, (filename) => {
				if (!isRelevantHomeChange(filename)) {
					return;
				}
				trigger();
			});

			if (existsSync(configPath)) {
				startWatching(configPath, () => {
					trigger();
				});
			}

			if (existsSync(envPath)) {
				startWatching(envPath, () => {
					trigger();
				});
			}

			if (existsSync(agentsDir)) {
				startWatching(agentsDir, () => {
					trigger();
				});
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
