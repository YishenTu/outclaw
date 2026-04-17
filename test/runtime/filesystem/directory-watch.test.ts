import { afterEach, describe, expect, test, vi } from "bun:test";
import {
	normalizeWatchFilename,
	startDirectoryWatch,
	type WatchHandle,
} from "../../../src/runtime/filesystem/directory-watch.ts";

describe("startDirectoryWatch", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	test("forwards changes from the provided watch factory", () => {
		const changes: Array<string | Buffer | null | undefined> = [];
		const fakeHandle: WatchHandle = {
			close() {},
		};

		const handle = startDirectoryWatch({
			errorLabel: "Directory watcher",
			path: "/workspace",
			recursive: true,
			onChange: (filename) => {
				changes.push(filename);
			},
			watchFactory: (path, options, listener) => {
				expect(path).toBe("/workspace");
				expect(options).toEqual({ recursive: true });
				listener("change", "config.json");
				return fakeHandle;
			},
		});

		expect(handle).toBe(fakeHandle);
		expect(changes).toEqual(["config.json"]);
	});

	test("logs labeled watcher errors", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		let errorListener:
			| ((error: Error | string | undefined) => void)
			| undefined;

		startDirectoryWatch({
			errorLabel: "Directory watcher",
			path: "/workspace",
			recursive: false,
			onChange() {},
			watchFactory: (_path, _options, _listener) => ({
				close() {},
				on(_event, listener) {
					errorListener = listener;
					return undefined;
				},
			}),
		});

		errorListener?.(new Error("boom"));

		expect(warnSpy).toHaveBeenCalledWith("Directory watcher error: boom");
	});
});

describe("normalizeWatchFilename", () => {
	test("normalizes string and buffer filenames", () => {
		expect(normalizeWatchFilename("config.json")).toBe("config.json");
		expect(normalizeWatchFilename(Buffer.from("agents"))).toBe("agents");
	});

	test("returns undefined for missing filenames", () => {
		expect(normalizeWatchFilename(undefined)).toBeUndefined();
		expect(normalizeWatchFilename(null)).toBeUndefined();
	});
});
