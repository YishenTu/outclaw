import { describe, expect, test } from "bun:test";
import { formatStatus, formatStatusCompact } from "../../src/common/status.ts";

describe("status formatting", () => {
	test("falls back to session id when the title is unavailable", () => {
		const event = {
			type: "runtime_status" as const,
			model: "opus",
			effort: "high",
			running: false,
			sessionId: "sdk-blank",
		};

		expect(formatStatus(event)).toContain("session  sdk-blank");
		expect(formatStatusCompact(event)).toContain("session: sdk-blank");
	});

	test("renders agent before model when present", () => {
		const event = {
			type: "runtime_status" as const,
			agentName: "railly",
			model: "opus",
			effort: "high",
			running: false,
			sessionTitle: "Chat",
		};

		expect(formatStatus(event)).toContain("agent    railly");
		expect(formatStatus(event)).toContain("model    opus");
		expect(formatStatusCompact(event)).toContain("agent: railly");
		expect(formatStatusCompact(event)).toContain("model: opus");
		expect(formatStatusCompact(event).indexOf("agent: railly")).toBeLessThan(
			formatStatusCompact(event).indexOf("model: opus"),
		);
	});
});
