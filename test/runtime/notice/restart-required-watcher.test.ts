import { afterEach, describe, expect, test, vi } from "bun:test";
import { createRestartRequiredWatcher } from "../../../src/runtime/notice/restart-required-watcher.ts";

interface FakeWatcher {
	close(): void;
	emit(filename?: string): void;
}

describe("createRestartRequiredWatcher", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	test("triggers for config and env changes in the outclaw home", () => {
		vi.useFakeTimers();
		const watchers = new Map<string, FakeWatcher>();
		const notifications: string[] = [];
		const watcher = createRestartRequiredWatcher({
			homeDir: "/workspace/.outclaw",
			onRestartRequired: () => {
				notifications.push("restart_required");
			},
			watchFactory: (path, _options, listener) => {
				const fakeWatcher: FakeWatcher = {
					close() {},
					emit(filename) {
						listener("change", filename);
					},
				};
				watchers.set(path, fakeWatcher);
				return fakeWatcher;
			},
		});

		watcher.start();
		watchers.get("/workspace/.outclaw")?.emit("config.json");
		vi.advanceTimersByTime(100);
		watchers.get("/workspace/.outclaw")?.emit(".env");
		vi.advanceTimersByTime(100);

		expect(notifications).toEqual(["restart_required", "restart_required"]);
		watcher.stop();
	});

	test("triggers for agent topology changes", () => {
		vi.useFakeTimers();
		const watchers = new Map<string, FakeWatcher>();
		const notifications: string[] = [];
		const watcher = createRestartRequiredWatcher({
			homeDir: "/workspace/.outclaw",
			onRestartRequired: () => {
				notifications.push("restart_required");
			},
			watchFactory: (path, _options, listener) => {
				const fakeWatcher: FakeWatcher = {
					close() {},
					emit(filename) {
						listener("change", filename);
					},
				};
				watchers.set(path, fakeWatcher);
				return fakeWatcher;
			},
		});

		watcher.start();
		watchers.get("/workspace/.outclaw")?.emit("agents");
		vi.advanceTimersByTime(100);

		expect(notifications).toEqual(["restart_required"]);
		watcher.stop();
	});
});
