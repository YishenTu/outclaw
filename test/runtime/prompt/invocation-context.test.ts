import { describe, expect, test } from "bun:test";
import { buildInvocationContext } from "../../../src/runtime/prompt/invocation-context.ts";

const FIXED_DATE = new Date("2026-04-07T14:30:00Z");

describe("buildInvocationContext", () => {
	test("includes date and time", () => {
		const result = buildInvocationContext({ now: FIXED_DATE });
		expect(result).toContain("2026");
		expect(result).toContain("April");
	});

	test("shows source when provided", () => {
		const result = buildInvocationContext({
			source: "telegram",
			now: FIXED_DATE,
		});
		expect(result).toContain("telegram");
	});

	test("shows tui as default source", () => {
		const result = buildInvocationContext({ now: FIXED_DATE });
		expect(result).toContain("tui");
	});

	test("shows session ID when resuming", () => {
		const result = buildInvocationContext({
			sessionId: "abc-123",
			now: FIXED_DATE,
		});
		expect(result).toContain("abc-123");
	});

	test("shows new session when no sessionId", () => {
		const result = buildInvocationContext({ now: FIXED_DATE });
		expect(result).toContain("new session");
	});

	test("defaults now to current date when not provided", () => {
		const result = buildInvocationContext({});
		const year = new Date().getFullYear().toString();
		expect(result).toContain(year);
	});
});
