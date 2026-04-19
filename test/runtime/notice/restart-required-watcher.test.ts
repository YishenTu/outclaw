import { afterEach, describe, expect, test, vi } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRestartRequiredWatcher } from "../../../src/runtime/notice/restart-required-watcher.ts";

interface FakeWatcher {
	close(): void;
	emit(filename?: string): void;
}

function createHomeDir() {
	const homeDir = mkdtempSync(join(tmpdir(), "outclaw-restart-watch-"));
	mkdirSync(join(homeDir, "agents"), { recursive: true });
	return homeDir;
}

function createWatchers(homeDir: string) {
	const watchers = new Map<string, FakeWatcher>();
	const notifications: string[] = [];
	const watcher = createRestartRequiredWatcher({
		homeDir,
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

	return { notifications, watcher, watchers };
}

describe("createRestartRequiredWatcher", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	test("ignores config and env events when contents are unchanged", () => {
		vi.useFakeTimers();
		const homeDir = createHomeDir();
		try {
			writeFileSync(join(homeDir, "config.json"), "{}\n");
			writeFileSync(join(homeDir, ".env"), "A=1\n");
			const { notifications, watcher, watchers } = createWatchers(homeDir);

			watcher.start();
			watchers.get(join(homeDir, "config.json"))?.emit();
			vi.advanceTimersByTime(100);
			watchers.get(join(homeDir, ".env"))?.emit();
			vi.advanceTimersByTime(100);

			expect(notifications).toEqual([]);
			watcher.stop();
		} finally {
			rmSync(homeDir, { force: true, recursive: true });
		}
	});

	test("triggers only when config and env contents actually change", () => {
		vi.useFakeTimers();
		const homeDir = createHomeDir();
		try {
			writeFileSync(join(homeDir, "config.json"), "{}\n");
			writeFileSync(join(homeDir, ".env"), "A=1\n");
			const { notifications, watcher, watchers } = createWatchers(homeDir);

			watcher.start();
			writeFileSync(join(homeDir, "config.json"), '{ "port": 4000 }\n');
			watchers.get(join(homeDir, "config.json"))?.emit();
			vi.advanceTimersByTime(100);
			writeFileSync(join(homeDir, ".env"), "A=2\n");
			watchers.get(join(homeDir, ".env"))?.emit();
			vi.advanceTimersByTime(100);

			expect(notifications).toEqual(["restart_required", "restart_required"]);
			watcher.stop();
		} finally {
			rmSync(homeDir, { force: true, recursive: true });
		}
	});

	test("ignores no-op agent events and triggers on actual topology changes", () => {
		vi.useFakeTimers();
		const homeDir = createHomeDir();
		try {
			mkdirSync(join(homeDir, "agents", "railly"), { recursive: true });
			const { notifications, watcher, watchers } = createWatchers(homeDir);

			watcher.start();
			watchers.get(join(homeDir, "agents"))?.emit();
			vi.advanceTimersByTime(100);
			mkdirSync(join(homeDir, "agents", "mimi"), { recursive: true });
			watchers.get(join(homeDir, "agents"))?.emit();
			vi.advanceTimersByTime(100);

			expect(notifications).toEqual(["restart_required"]);
			watcher.stop();
		} finally {
			rmSync(homeDir, { force: true, recursive: true });
		}
	});

	test("triggers for config and env file events without filenames when contents changed", () => {
		vi.useFakeTimers();
		const homeDir = createHomeDir();
		try {
			writeFileSync(join(homeDir, "config.json"), "{}\n");
			writeFileSync(join(homeDir, ".env"), "A=1\n");
			const { notifications, watcher, watchers } = createWatchers(homeDir);

			watcher.start();
			writeFileSync(join(homeDir, "config.json"), '{ "host": "0.0.0.0" }\n');
			watchers.get(join(homeDir, "config.json"))?.emit();
			vi.advanceTimersByTime(100);
			writeFileSync(join(homeDir, ".env"), "A=2\n");
			watchers.get(join(homeDir, ".env"))?.emit();
			vi.advanceTimersByTime(100);

			expect(notifications).toEqual(["restart_required", "restart_required"]);
			watcher.stop();
		} finally {
			rmSync(homeDir, { force: true, recursive: true });
		}
	});
});
