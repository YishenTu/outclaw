import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assembleSystemPrompt } from "../../../src/runtime/prompt/assemble-system-prompt.ts";

let tmp: string;

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "mis-test-"));
});

afterEach(() => {
	rmSync(tmp, { recursive: true });
});

describe("assembleSystemPrompt", () => {
	test("returns empty string when no files exist", async () => {
		const result = await assembleSystemPrompt(tmp);
		expect(result).toBe("");
	});

	test("returns file content wrapped in xml tags", async () => {
		writeFileSync(join(tmp, "AGENTS.md"), "be helpful");

		const result = await assembleSystemPrompt(tmp);
		expect(result).toContain("<agents>");
		expect(result).toContain("be helpful");
	});

	test("preserves file order", async () => {
		writeFileSync(join(tmp, "AGENTS.md"), "agents");
		writeFileSync(join(tmp, "MEMORY.md"), "memory");

		const result = await assembleSystemPrompt(tmp);

		const agentsIdx = result.indexOf("<agents>");
		const memoryIdx = result.indexOf("<memory>");
		expect(agentsIdx).toBeLessThan(memoryIdx);
	});
});
