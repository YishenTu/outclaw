import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assembleSystemPrompt } from "../../../src/runtime/prompt/assemble-system-prompt.ts";

const FIXED_DATE = new Date("2026-04-07T14:30:00Z");
let tmp: string;

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "mis-test-"));
});

afterEach(() => {
	rmSync(tmp, { recursive: true });
});

describe("assembleSystemPrompt", () => {
	test("returns just invocation context when no files exist", async () => {
		const result = await assembleSystemPrompt({
			promptHomeDir: tmp,
			now: FIXED_DATE,
		});
		expect(result).toContain("Invocation Context");
		expect(result).toContain("2026");
	});

	test("combines file content and invocation context", async () => {
		writeFileSync(join(tmp, "AGENTS.md"), "be helpful");

		const result = await assembleSystemPrompt({
			promptHomeDir: tmp,
			now: FIXED_DATE,
		});
		expect(result).toContain("be helpful");
		expect(result).toContain("Invocation Context");
	});

	test("preserves file order before context", async () => {
		writeFileSync(join(tmp, "AGENTS.md"), "agents");
		writeFileSync(join(tmp, "MEMORY.md"), "memory");

		const result = await assembleSystemPrompt({
			promptHomeDir: tmp,
			now: FIXED_DATE,
		});

		const agentsIdx = result.indexOf("agents");
		const memoryIdx = result.indexOf("memory");
		const contextIdx = result.indexOf("Invocation Context");
		expect(agentsIdx).toBeLessThan(memoryIdx);
		expect(memoryIdx).toBeLessThan(contextIdx);
	});

	test("passes source and sessionId to invocation context", async () => {
		const result = await assembleSystemPrompt({
			promptHomeDir: tmp,
			source: "telegram",
			sessionId: "sess-42",
			now: FIXED_DATE,
		});
		expect(result).toContain("telegram");
		expect(result).toContain("sess-42");
	});

	test("returns only invocation context when promptHomeDir is undefined", async () => {
		const result = await assembleSystemPrompt({
			now: FIXED_DATE,
		});
		expect(result).toContain("Invocation Context");
		expect(result).not.toContain("# misanthropic");
	});
});
