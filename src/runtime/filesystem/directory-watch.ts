import { type FSWatcher, watch } from "node:fs";

export interface WatchFactoryOptions {
	recursive: boolean;
}

export type WatchFilename = string | Buffer | null | undefined;

export type WatchListener = (
	eventType: string,
	filename: WatchFilename,
) => void;

export interface WatchHandle {
	close(): void;
	on?(
		event: "error",
		listener: (error: Error | string | undefined) => void,
	): unknown;
}

export type WatchFactory = (
	path: string,
	options: WatchFactoryOptions,
	listener: WatchListener,
) => WatchHandle;

interface StartDirectoryWatchOptions {
	errorLabel: string;
	onChange: (filename: WatchFilename) => void;
	path: string;
	recursive: boolean;
	watchFactory?: WatchFactory;
}

export function normalizeWatchFilename(
	filename: WatchFilename,
): string | undefined {
	if (!filename) {
		return undefined;
	}
	return String(filename);
}

export function startDirectoryWatch(
	options: StartDirectoryWatchOptions,
): WatchHandle {
	const watchFactory = options.watchFactory ?? defaultWatchFactory;
	const handle = watchFactory(
		options.path,
		{ recursive: options.recursive },
		(_event, filename) => {
			options.onChange(filename);
		},
	);

	handle.on?.("error", (error) => {
		console.warn(
			`${options.errorLabel} error: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	});

	return handle;
}

function defaultWatchFactory(
	path: string,
	options: WatchFactoryOptions,
	listener: WatchListener,
): WatchHandle {
	return watch(path, options, listener) as FSWatcher;
}
