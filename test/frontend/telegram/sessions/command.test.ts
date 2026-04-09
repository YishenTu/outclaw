import { describe, expect, test } from "bun:test";
import {
	buildSessionCommandRequest,
	formatSessionCommandReply,
} from "../../../../src/frontend/telegram/sessions/command.ts";

describe("Telegram session commands", () => {
	describe("buildSessionCommandRequest", () => {
		test("uses the menu flow when no match is provided", () => {
			const request = buildSessionCommandRequest();

			expect(request).toEqual({
				command: "/session",
				expectedTypes: new Set(["session_menu"]),
				showMenu: true,
			});
		});

		test("builds the list command for trimmed list arguments", () => {
			const request = buildSessionCommandRequest(" list ");

			expect(request).toEqual({
				command: "/session list",
				expectedTypes: new Set(["session_list"]),
				showMenu: false,
			});
		});

		test("builds the switch command for bare session ids", () => {
			const request = buildSessionCommandRequest(" sdk-target ");

			expect(request).toEqual({
				command: "/session sdk-target",
				expectedTypes: new Set(["session_switched"]),
				showMenu: false,
			});
		});

		test("builds mutation commands for delete and rename", () => {
			expect(buildSessionCommandRequest("delete sdk-1")).toEqual({
				command: "/session delete sdk-1",
				expectedTypes: new Set(["session_deleted"]),
				showMenu: false,
			});
			expect(buildSessionCommandRequest("rename sdk-1 New title")).toEqual({
				command: "/session rename sdk-1 New title",
				expectedTypes: new Set(["session_renamed"]),
				showMenu: false,
			});
		});
	});

	describe("formatSessionCommandReply", () => {
		test("formats session lists", () => {
			expect(
				formatSessionCommandReply({
					type: "session_list",
					sessions: [
						{ sdkSessionId: "abcdef123456", title: "First session" },
						{ sdkSessionId: "fedcba654321", title: "Second session" },
					],
				}),
			).toBe("abcdef12  First session\nfedcba65  Second session");
		});

		test("formats empty session lists", () => {
			expect(
				formatSessionCommandReply({
					type: "session_list",
					sessions: [],
				}),
			).toBe("No sessions");
		});

		test("formats switch, rename, delete, and error events", () => {
			expect(
				formatSessionCommandReply({
					type: "session_switched",
					title: "Recovered chat",
				}),
			).toBe("Switched to: Recovered chat");
			expect(
				formatSessionCommandReply({
					type: "session_renamed",
					title: "Renamed chat",
				}),
			).toBe("Renamed: Renamed chat");
			expect(
				formatSessionCommandReply({
					type: "session_deleted",
					sdkSessionId: "sdk-del",
				}),
			).toBe("Deleted: sdk-del");
			expect(
				formatSessionCommandReply({
					type: "error",
					message: "unknown session",
				}),
			).toBe("[error] unknown session");
		});
	});
});
