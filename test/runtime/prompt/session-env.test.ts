import { describe, expect, test } from "bun:test";
import { buildSessionEnv } from "../../../src/runtime/prompt/session-env.ts";

describe("buildSessionEnv", () => {
	test("returns undefined when promptHomeDir is missing", () => {
		expect(buildSessionEnv(undefined, "sess-1")).toBeUndefined();
	});

	test("echoes OC_MEMORY_ROOT from the provided home dir", () => {
		const env = buildSessionEnv("/path/to/home", "sess-1");
		expect(env?.OC_MEMORY_ROOT).toBe("/path/to/home");
	});

	test("echoes the caller-supplied OC_SESSION_ID", () => {
		const env = buildSessionEnv("/home", "abc-123");
		expect(env?.OC_SESSION_ID).toBe("abc-123");
	});
});
