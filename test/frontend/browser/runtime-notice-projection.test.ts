import { describe, expect, test } from "bun:test";
import {
	createRuntimeNoticeKey,
	projectRuntimeNotice,
} from "../../../src/frontend/browser/notices/runtime-notice-projection.ts";

describe("runtime notice projection", () => {
	test("projects restart-required notices as persistent browser notices", () => {
		expect(projectRuntimeNotice({ kind: "restart_required" })).toEqual({
			key: "notice-restart",
			title: "Restart required",
			detail: "Changes won't update until the runtime restarts.",
			dismissible: false,
		});
		expect(createRuntimeNoticeKey({ kind: "restart_required" })).toBe(
			"restart_required",
		);
	});

	test("projects rollover notices as dismissible browser notices keyed by message", () => {
		const notice = {
			kind: "rollover" as const,
			message: "Session rolled over after idle timeout.",
		};

		expect(projectRuntimeNotice(notice)).toEqual({
			key: "notice-rollover",
			title: "Session rollover",
			detail: "Session rolled over after idle timeout.",
			dismissible: true,
		});
		expect(createRuntimeNoticeKey(notice)).toBe(
			"rollover:Session rolled over after idle timeout.",
		);
	});
});
