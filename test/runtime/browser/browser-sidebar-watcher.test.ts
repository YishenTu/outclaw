import { afterEach, describe, expect, test, vi } from "bun:test";
import { createBrowserSidebarWatcher } from "../../../src/runtime/browser/browser-sidebar-watcher.ts";

interface FakeWatcher {
	close(): void;
	emit(filename?: string): void;
}

describe("createBrowserSidebarWatcher", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	test("maps git-root changes onto git, tree, and cron invalidations", () => {
		vi.useFakeTimers();
		const watchers = new Map<string, FakeWatcher>();
		const events: Array<{
			agentId?: string;
			sections: string[];
			type: string;
		}> = [];
		const watcher = createBrowserSidebarWatcher({
			agents: [
				{
					agentId: "agent-alpha",
					rootDir: "/workspace/agents/alpha",
				},
			],
			gitRoot: "/workspace",
			onInvalidate: (event) => {
				events.push({
					type: event.type,
					agentId: event.agentId,
					sections: [...event.sections],
				});
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
		watchers.get("/workspace")?.emit("agents/alpha/cron/job.yaml");
		vi.advanceTimersByTime(100);

		expect(events).toEqual([
			{
				type: "browser_sidebar_invalidated",
				agentId: "agent-alpha",
				sections: ["git", "tree", "cron"],
			},
		]);

		watcher.stop();
	});

	test("emits git-only invalidations for repo changes outside agent roots", () => {
		vi.useFakeTimers();
		const watchers = new Map<string, FakeWatcher>();
		const events: Array<{
			agentId?: string;
			sections: string[];
			type: string;
		}> = [];
		const watcher = createBrowserSidebarWatcher({
			agents: [
				{
					agentId: "agent-alpha",
					rootDir: "/workspace/agents/alpha",
				},
			],
			gitRoot: "/workspace",
			onInvalidate: (event) => {
				events.push({
					type: event.type,
					agentId: event.agentId,
					sections: [...event.sections],
				});
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
		watchers.get("/workspace")?.emit("README.md");
		vi.advanceTimersByTime(100);

		expect(events).toEqual([
			{
				type: "browser_sidebar_invalidated",
				sections: ["git"],
			},
		]);

		watcher.stop();
	});
});
