import { afterEach, describe, expect, test, vi } from "bun:test";
import { createFrontendNoticeWatcher } from "../../../src/runtime/notice/frontend-notice-watcher.ts";

describe("createFrontendNoticeWatcher", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	test("emits only when the frontend notice changes", () => {
		vi.useFakeTimers();
		let notice:
			| {
					kind: "restart_required";
			  }
			| undefined;
		const changes: Array<string | undefined> = [];
		const watcher = createFrontendNoticeWatcher({
			readNotice: () => notice,
			onChange: (nextNotice) => {
				changes.push(nextNotice?.kind);
			},
			pollIntervalMs: 100,
		});

		watcher.start();
		vi.advanceTimersByTime(100);
		expect(changes).toEqual([]);

		notice = { kind: "restart_required" };
		vi.advanceTimersByTime(100);
		expect(changes).toEqual(["restart_required"]);

		vi.advanceTimersByTime(100);
		expect(changes).toEqual(["restart_required"]);

		notice = undefined;
		vi.advanceTimersByTime(100);
		expect(changes).toEqual(["restart_required", undefined]);

		watcher.stop();
	});
});
