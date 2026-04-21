import { afterEach, describe, expect, mock, test, vi } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMemoryIndexWatcher } from "../../../src/runtime/cron/memory-index-watcher.ts";
import type { WatchHandle } from "../../../src/runtime/filesystem/directory-watch.ts";

interface FakeWatcher extends WatchHandle {
	emit(filename?: string): void;
}

describe("startMemoryIndexWatcher", () => {
	afterEach(() => {
		vi.useRealTimers();
		for (const root of tempRoots.splice(0)) {
			if (existsSync(root)) {
				rmSync(root, { force: true, recursive: true });
			}
		}
	});

	const tempRoots: string[] = [];

	function createMemoryRoot(): string {
		const root = mkdtempSync(join(tmpdir(), "outclaw-memory-watch-"));
		mkdirSync(join(root, "schemas"), { recursive: true });
		tempRoots.push(root);
		return root;
	}

	test("refreshes once immediately on start", () => {
		const memoryRoot = createMemoryRoot();
		const refresh = mock((_: string) => undefined);
		const handle = startMemoryIndexWatcher({
			memoryRoot,
			refresh,
			watchFactory: (_path, _options, _listener) => ({
				close() {},
			}),
		});

		expect(refresh).toHaveBeenCalledTimes(1);
		expect(refresh).toHaveBeenCalledWith(memoryRoot);
		handle.stop();
	});

	test("refreshes after relevant filesystem changes under schemas/", () => {
		vi.useFakeTimers();
		const memoryRoot = createMemoryRoot();
		let watcher: FakeWatcher | undefined;
		const refresh = mock((_: string) => undefined);
		const handle = startMemoryIndexWatcher({
			memoryRoot,
			debounceMs: 100,
			refresh,
			watchFactory: (path, options, listener) => {
				expect(path).toBe(join(memoryRoot, "schemas"));
				expect(options).toEqual({ recursive: false });
				watcher = {
					close() {},
					emit(filename) {
						listener("change", filename);
					},
				};
				return watcher;
			},
		});

		watcher?.emit("project.md");
		vi.advanceTimersByTime(100);

		expect(refresh).toHaveBeenCalledTimes(2);
		expect(refresh).toHaveBeenNthCalledWith(2, memoryRoot);
		handle.stop();
	});

	test("ignores unrelated filesystem changes", () => {
		vi.useFakeTimers();
		const memoryRoot = createMemoryRoot();
		let watcher: FakeWatcher | undefined;
		const refresh = mock((_: string) => undefined);
		const handle = startMemoryIndexWatcher({
			memoryRoot,
			debounceMs: 100,
			refresh,
			watchFactory: (_path, _options, listener) => {
				watcher = {
					close() {},
					emit(filename) {
						listener("change", filename);
					},
				};
				return watcher;
			},
		});

		watcher?.emit("index.md");
		watcher?.emit("project.txt");
		vi.advanceTimersByTime(100);

		expect(refresh).toHaveBeenCalledTimes(1);
		handle.stop();
	});

	test("debounces bursts of relevant filesystem changes into one refresh", () => {
		vi.useFakeTimers();
		const memoryRoot = createMemoryRoot();
		let watcher: FakeWatcher | undefined;
		const refresh = mock((_: string) => undefined);
		const handle = startMemoryIndexWatcher({
			memoryRoot,
			debounceMs: 100,
			refresh,
			watchFactory: (_path, _options, listener) => {
				watcher = {
					close() {},
					emit(filename) {
						listener("change", filename);
					},
				};
				return watcher;
			},
		});

		watcher?.emit("project.md");
		watcher?.emit("project.md");
		watcher?.emit("another.md");
		vi.advanceTimersByTime(100);

		expect(refresh).toHaveBeenCalledTimes(2);
		handle.stop();
	});

	test("swallows refresh errors from the initial run and watched updates", () => {
		vi.useFakeTimers();
		const memoryRoot = createMemoryRoot();
		let watcher: FakeWatcher | undefined;
		const refresh = mock(() => {
			throw new Error("boom");
		});
		const onError = mock((_: unknown) => undefined);
		const handle = startMemoryIndexWatcher({
			memoryRoot,
			debounceMs: 100,
			refresh,
			onError,
			watchFactory: (_path, _options, listener) => {
				watcher = {
					close() {},
					emit(filename) {
						listener("change", filename);
					},
				};
				return watcher;
			},
		});

		watcher?.emit("project.md");
		vi.advanceTimersByTime(100);

		expect(onError).toHaveBeenCalledTimes(2);
		expect(refresh).toHaveBeenCalledTimes(2);
		handle.stop();
	});

	test("stop closes the watcher and cancels a pending refresh", () => {
		vi.useFakeTimers();
		const memoryRoot = createMemoryRoot();
		let watcher: FakeWatcher | undefined;
		const refresh = mock((_: string) => undefined);
		const close = mock(() => undefined);
		const handle = startMemoryIndexWatcher({
			memoryRoot,
			debounceMs: 100,
			refresh,
			watchFactory: (_path, _options, listener) => {
				watcher = {
					close,
					emit(filename) {
						listener("change", filename);
					},
				};
				return watcher;
			},
		});

		watcher?.emit("project.md");
		handle.stop();
		vi.advanceTimersByTime(100);

		expect(close).toHaveBeenCalledTimes(1);
		expect(refresh).toHaveBeenCalledTimes(1);
	});

	test("does not start a filesystem watch when the memory root is missing", () => {
		const refresh = mock((_: string) => undefined);
		const watchFactory = mock(() => ({
			close() {},
		}));

		const handle = startMemoryIndexWatcher({
			memoryRoot: "/definitely-missing-memory-root",
			refresh,
			watchFactory,
		});

		expect(refresh).toHaveBeenCalledTimes(1);
		expect(watchFactory).not.toHaveBeenCalled();
		handle.stop();
	});
});
