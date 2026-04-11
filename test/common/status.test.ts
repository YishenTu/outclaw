import { describe, expect, test } from "bun:test";
import { formatStatus, formatStatusCompact } from "../../src/common/status.ts";

describe("status formatting", () => {
	test("falls back to session id when the title is unavailable", () => {
		const event = {
			type: "runtime_status" as const,
			model: "opus",
			effort: "high",
			sessionId: "sdk-blank",
		};

		expect(formatStatus(event)).toContain("session  sdk-blank");
		expect(formatStatusCompact(event)).toContain("session: sdk-blank");
	});
});
